import csv
import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership
from app.modules.businesses.models import Membership, Store
from app.modules.catalog.models import Product, ProductVariant
from app.modules.customers.models import Customer, CustomerLedgerEntry
from app.modules.finance.models import CashbookEntry
from app.modules.inventory.models import InventoryBalance, Purchase, StockMovement, Supplier, SupplierPayment
from app.modules.reports.schemas import (
    DashboardReportOut,
    DebtorReportOut,
    InventoryReportOut,
    ProfitReportOut,
    SalesReportOut,
    StorePerformanceOut,
    SupplierReportOut,
)
from app.modules.sales.models import Sale, SaleItem, SaleRefund

router = APIRouter()


def _safe_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid numeric value provided.")


def _money(value: Decimal | int | str) -> Decimal:
    return _safe_decimal(value).quantize(Decimal("0.01"))


def _validate_store(membership: Membership, store_id: str | None, db: Session) -> None:
    if not store_id:
        return
    store = (
        db.query(Store)
        .filter(Store.id == store_id, Store.business_id == membership.business_id, Store.is_active.is_(True))
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found in this business.")
    if membership.role != "owner" and store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this store.")


def _filtered_sales(membership: Membership, db: Session, store_id: str | None, start_date: date | None, end_date: date | None):
    query = db.query(Sale).filter(Sale.business_id == membership.business_id)
    if store_id:
        _validate_store(membership, store_id, db)
        query = query.filter(Sale.store_id == store_id)
    elif membership.role != "owner":
        query = query.filter(Sale.store_id.in_(membership.store_access or []))
    if start_date:
        query = query.filter(func.date(Sale.created_at) >= start_date.isoformat())
    if end_date:
        query = query.filter(func.date(Sale.created_at) <= end_date.isoformat())
    return query.order_by(Sale.created_at.desc()).all()


def _filtered_cashbook(membership: Membership, db: Session, store_id: str | None, start_date: date | None, end_date: date | None):
    query = db.query(CashbookEntry).filter(CashbookEntry.business_id == membership.business_id, CashbookEntry.reversal_of_id.is_(None))
    if store_id:
        _validate_store(membership, store_id, db)
        query = query.filter(CashbookEntry.store_id == store_id)
    elif membership.role != "owner":
        query = query.filter(CashbookEntry.store_id.in_(membership.store_access or []))
    if start_date:
        query = query.filter(func.date(CashbookEntry.created_at) >= start_date.isoformat())
    if end_date:
        query = query.filter(func.date(CashbookEntry.created_at) <= end_date.isoformat())
    return query.order_by(CashbookEntry.created_at.desc()).all()


def _filtered_inventory(membership: Membership, db: Session, store_id: str | None):
    query = db.query(InventoryBalance).filter(InventoryBalance.business_id == membership.business_id)
    if store_id:
        _validate_store(membership, store_id, db)
        query = query.filter(InventoryBalance.store_id == store_id)
    elif membership.role != "owner":
        query = query.filter(InventoryBalance.store_id.in_(membership.store_access or []))
    return query.all()


def _total_refunds_for_sales(membership: Membership, db: Session, sales: list[Sale]) -> Decimal:
    sale_ids = [sale.id for sale in sales]
    if not sale_ids:
        return Decimal("0")
    total = (
        db.query(func.coalesce(func.sum(SaleRefund.amount), Decimal("0")))
        .join(Sale, Sale.id == SaleRefund.sale_id)
        .filter(Sale.business_id == membership.business_id, SaleRefund.sale_id.in_(sale_ids))
        .scalar()
    )
    return _safe_decimal(total or 0)

def _cost_of_goods_sold(membership: Membership, db: Session, sales: list[Sale]) -> Decimal:
    total = Decimal("0")
    for sale in sales:
        legacy_cost_variants: set[str] = set()
        for item in sale.items:
            if item.unit_cost is not None:
                total += Decimal(str(item.quantity)) * Decimal(str(item.unit_cost))
                continue
            if item.variant_id in legacy_cost_variants:
                continue
            legacy_cost_variants.add(item.variant_id)
            movement_cost = (
                db.query(func.coalesce(func.sum(StockMovement.quantity_delta * StockMovement.unit_cost), Decimal("0")))
                .filter(
                    StockMovement.business_id == membership.business_id,
                    StockMovement.store_id == sale.store_id,
                    StockMovement.reference_type == "sale",
                    StockMovement.reference_id == sale.id,
                    StockMovement.variant_id == item.variant_id,
                    StockMovement.movement_type == "sale",
                )
                .scalar()
            )
            total += abs(_safe_decimal(movement_cost or 0))
        refund_ids = [
            refund.id for refund in db.query(SaleRefund).filter(SaleRefund.sale_id == sale.id).all()
        ]
        returned_cost = (
            db.query(func.coalesce(func.sum(StockMovement.quantity_delta * StockMovement.unit_cost), Decimal("0")))
            .filter(
                StockMovement.business_id == membership.business_id,
                StockMovement.store_id == sale.store_id,
                StockMovement.reference_type == "sale_refund",
                StockMovement.movement_type == "refund",
                or_(
                    StockMovement.reference_id.in_(refund_ids),
                    StockMovement.reference_id == sale.id,
                ),
            )
            .scalar()
        )
        total -= _safe_decimal(returned_cost or 0)
    return max(Decimal("0"), total)


def _sale_items_sold(sales: list[Sale]) -> Decimal:
    total = Decimal("0")
    for sale in sales:
        total += sum((Decimal(str(item.quantity)) for item in sale.items), Decimal("0"))
    return total


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _filter_dashboard_permissions(
    report: DashboardReportOut,
    membership: Membership,
    store_id: str | None,
) -> DashboardReportOut:
    if membership.role == "owner":
        return report

    permissions = set(membership.permissions or [])
    can_view_reports = "view_reports" in permissions
    can_view_sales = can_view_reports or "manage_sales" in permissions
    can_view_finance = can_view_reports or "manage_finance" in permissions
    can_view_inventory = can_view_reports or "manage_inventory" in permissions
    can_view_customers = can_view_reports or "manage_customers" in permissions
    can_view_suppliers = can_view_reports or "manage_suppliers" in permissions or "manage_finance" in permissions
    zero = Decimal("0")
    return report.model_copy(update={
        "sales": report.sales if can_view_sales else report.sales.model_copy(update={
            "total_sales": zero,
            "total_refunds": zero,
            "net_sales": zero,
            "total_transactions": 0,
            "average_transaction_value": zero,
            "total_items_sold": zero,
        }),
        "profit": report.profit if can_view_finance else report.profit.model_copy(update={
            "gross_revenue": zero,
            "cost_of_goods_sold": zero,
            "gross_profit": zero,
            "total_refunds": zero,
            "net_profit": zero,
        }),
        "inventory": report.inventory if can_view_inventory else report.inventory.model_copy(update={
            "total_variants": 0,
            "total_quantity": zero,
            "total_stock_value": zero,
            "total_retail_value": zero,
            "out_of_stock_variants": 0,
            "low_stock_items": [],
            "best_selling_products": [],
            "slow_moving_products": [],
        }),
        "debtors": report.debtors if can_view_customers else report.debtors.model_copy(update={
            "customer_count": 0,
            "total_outstanding": zero,
            "overdue_customers": 0,
            "customers": [],
        }),
        "suppliers": report.suppliers if can_view_suppliers else report.suppliers.model_copy(update={
            "supplier_count": 0,
            "total_payables": zero,
            "suppliers": [],
        }),
        "store_performance": [
            store.model_copy(update={
                "sales_total": store.sales_total if can_view_sales else zero,
                "transaction_count": store.transaction_count if can_view_sales else 0,
                "expense_total": store.expense_total if can_view_finance else zero,
                "net_cash": store.net_cash if can_view_finance else zero,
            })
            for store in report.store_performance
            if store_id is None or store.store_id == store_id
        ],
    })


@router.get("/dashboard")
def dashboard_report(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    permissions = set(membership.permissions or [])
    if membership.role != "owner" and not permissions.intersection({"view_dashboard", "view_reports"}):
        raise HTTPException(status_code=403, detail="You do not have permission to view dashboard reports.")

    sales = _filtered_sales(membership, db, store_id, start_date, end_date)
    total_refunds = _money(_total_refunds_for_sales(membership, db, sales))
    gross_sales = _money(sum((sale.total_amount for sale in sales), Decimal("0")))
    sales_report = SalesReportOut(
        total_sales=gross_sales,
        total_refunds=total_refunds,
        net_sales=_money(gross_sales - total_refunds),
        total_transactions=len(sales),
        average_transaction_value=_money((gross_sales / Decimal(len(sales))) if sales else Decimal("0")),
        total_items_sold=_money(_sale_items_sold(sales)),
        start_date=start_date,
        end_date=end_date,
    )

    cogs_total = _money(_cost_of_goods_sold(membership, db, sales))
    gross_profit = _money(gross_sales - cogs_total)
    profit_report = ProfitReportOut(
        gross_revenue=gross_sales,
        cost_of_goods_sold=cogs_total,
        gross_profit=gross_profit,
        total_refunds=total_refunds,
        net_profit=_money(gross_profit - total_refunds),
        start_date=start_date,
        end_date=end_date,
    )

    inventory_rows = _filtered_inventory(membership, db, store_id)
    best_selling = []
    sales_by_variant = {}
    for sale in sales:
        for item in sale.items:
            sales_by_variant[item.variant_id] = sales_by_variant.get(item.variant_id, Decimal("0")) + Decimal(str(item.quantity))
    for variant_id, qty in sorted(sales_by_variant.items(), key=lambda pair: pair[1], reverse=True)[:10]:
        variant = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
        product = db.query(Product).filter(Product.id == variant.product_id).first() if variant else None
        if variant and product:
            best_selling.append({
                "variant_id": variant.id,
                "product_name": product.name,
                "sku": variant.sku,
                "quantity_sold": str(qty),
            })

    low_stock = []
    total_quantity = Decimal("0")
    total_stock_value = Decimal("0")
    for balance in inventory_rows:
        variant = db.query(ProductVariant).filter(ProductVariant.id == balance.variant_id).first()
        product = db.query(Product).filter(Product.id == variant.product_id).first() if variant else None
        if not variant or not product:
            continue
        quantity = Decimal(str(balance.quantity))
        total_quantity += quantity
        unit_cost = Decimal(str(balance.average_cost or 0))
        total_stock_value += quantity * unit_cost
        if quantity <= Decimal(str(variant.low_stock_threshold or 0)):
            low_stock.append({
                "variant_id": variant.id,
                "product_name": product.name,
                "sku": variant.sku,
                "quantity": str(quantity),
                "reorder_level": str(variant.low_stock_threshold or 0),
                "stock_value": str(quantity * unit_cost),
            })

    slow_moving = []
    if sales:
        sold_by_variant = {}
        for sale in sales:
            for item in sale.items:
                sold_by_variant[item.variant_id] = sold_by_variant.get(item.variant_id, Decimal("0")) + Decimal(str(item.quantity))
        for variant_id, qty in sorted(sold_by_variant.items(), key=lambda pair: pair[1]):
            variant = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
            product = db.query(Product).filter(Product.id == variant.product_id).first() if variant else None
            if variant and product:
                slow_moving.append({
                    "variant_id": variant.id,
                    "product_name": product.name,
                    "sku": variant.sku,
                    "quantity_sold": str(qty),
                })
    inventory_report = InventoryReportOut(
        total_variants=len(inventory_rows),
        total_quantity=total_quantity,
        total_stock_value=total_stock_value,
        low_stock_items=[{
            "variant_id": item["variant_id"],
            "product_name": item["product_name"],
            "sku": item["sku"],
            "quantity": _safe_decimal(item["quantity"]),
            "reorder_level": _safe_decimal(item["reorder_level"]),
            "stock_value": _safe_decimal(item["stock_value"]),
        } for item in low_stock],
        best_selling_products=best_selling,
        slow_moving_products=slow_moving[:10],
    )

    customer_rows = (
        db.query(Customer)
        .filter(Customer.business_id == membership.business_id, Customer.is_active.is_(True))
        .all()
    )
    debtor_customers = []
    total_outstanding = Decimal("0")
    overdue_customers = 0
    for customer in customer_rows:
        balance = (
            db.query(func.coalesce(func.sum(CustomerLedgerEntry.amount), Decimal("0")))
            .filter(
                CustomerLedgerEntry.business_id == membership.business_id,
                CustomerLedgerEntry.customer_id == customer.id,
            )
            .scalar()
        )
        outstanding = _safe_decimal(balance or 0)
        total_outstanding += outstanding
        if outstanding > 0:
            overdue_customers += 1
        debtor_customers.append({
            "customer_id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "outstanding_balance": str(outstanding),
        })
    debtors_report = DebtorReportOut(
        customer_count=len(customer_rows),
        total_outstanding=total_outstanding,
        overdue_customers=overdue_customers,
        customers=debtor_customers,
    )

    supplier_rows = db.query(Supplier).filter(Supplier.business_id == membership.business_id).all()
    supplier_summaries = []
    total_payables = Decimal("0")
    for supplier in supplier_rows:
        purchase_total = (
            db.query(func.coalesce(func.sum(Purchase.total_amount), Decimal("0")))
            .filter(
                Purchase.business_id == membership.business_id,
                Purchase.supplier_id == supplier.id,
                Purchase.status == "received",
            )
            .scalar()
        )
        payment_total = (
            db.query(func.coalesce(func.sum(SupplierPayment.amount), Decimal("0")))
            .filter(
                SupplierPayment.business_id == membership.business_id,
                SupplierPayment.supplier_id == supplier.id,
                SupplierPayment.reversal_of_id.is_(None),
            )
            .scalar()
        )
        payable = _safe_decimal(purchase_total or 0) - _safe_decimal(payment_total or 0)
        total_payables += payable
        supplier_summaries.append({
            "supplier_id": supplier.id,
            "name": supplier.name,
            "payable_balance": str(payable),
        })
    supplier_report = SupplierReportOut(
        supplier_count=len(supplier_rows),
        total_payables=total_payables,
        suppliers=supplier_summaries,
    )

    store_rows = db.query(Store).filter(Store.business_id == membership.business_id, Store.is_active.is_(True)).all()
    store_performance = []
    for store in store_rows:
        filtered_sales = [sale for sale in sales if sale.store_id == store.id]
        sales_total = sum((sale.total_amount for sale in filtered_sales), Decimal("0"))
        store_cashbook = _filtered_cashbook(membership, db, store.id, start_date, end_date)
        expense_total = sum((entry.amount for entry in store_cashbook if entry.direction == "out"), Decimal("0"))
        cash_total = sum((entry.amount for entry in store_cashbook if entry.direction == "in"), Decimal("0"))
        store_performance.append(
            StorePerformanceOut(
                store_id=store.id,
                store_name=store.name,
                sales_total=sales_total,
                expense_total=expense_total,
                net_cash=cash_total - expense_total,
                transaction_count=len(filtered_sales),
            )
        )

    report = DashboardReportOut(
        sales=sales_report,
        profit=profit_report,
        inventory=inventory_report,
        debtors=debtors_report,
        suppliers=supplier_report,
        store_performance=store_performance,
    )
    return _filter_dashboard_permissions(report, membership, store_id)


@router.get("/mobile-dashboard", response_model=DashboardReportOut)
def mobile_dashboard_report(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    if membership.role != "owner" and "view_dashboard" not in (membership.permissions or []):
        raise HTTPException(status_code=403, detail="You do not have permission to view the dashboard.")
    return dashboard_report(store_id, start_date, end_date, membership, db)


@router.get("/sales")
def sales_report(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    sales = _filtered_sales(membership, db, store_id, start_date, end_date)
    gross_sales = _money(sum((sale.total_amount for sale in sales), Decimal("0")))
    total_refunds = _money(_total_refunds_for_sales(membership, db, sales))
    return SalesReportOut(
        total_sales=gross_sales,
        total_refunds=total_refunds,
        net_sales=_money(gross_sales - total_refunds),
        total_transactions=len(sales),
        average_transaction_value=_money((gross_sales / Decimal(len(sales))) if sales else Decimal("0")),
        total_items_sold=_money(_sale_items_sold(sales)),
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/profit")
def profit_report(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    sales = _filtered_sales(membership, db, store_id, start_date, end_date)
    gross_sales = _money(sum((sale.total_amount for sale in sales), Decimal("0")))
    total_refunds = _money(_total_refunds_for_sales(membership, db, sales))
    cost_of_goods_sold = _money(_cost_of_goods_sold(membership, db, sales))
    gross_profit = _money(gross_sales - cost_of_goods_sold)
    return ProfitReportOut(
        gross_revenue=gross_sales,
        cost_of_goods_sold=cost_of_goods_sold,
        gross_profit=gross_profit,
        total_refunds=total_refunds,
        net_profit=_money(gross_profit - total_refunds),
        start_date=start_date,
        end_date=end_date,
    )


@router.get("/expenses")
def expense_report(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    entries = _filtered_cashbook(membership, db, store_id, start_date, end_date)
    outgoing = [entry for entry in entries if entry.direction == "out"]
    total_expenses = _money(sum((entry.amount for entry in outgoing), Decimal("0")))
    by_category = {}
    for entry in outgoing:
        by_category[entry.category] = by_category.get(entry.category, Decimal("0")) + entry.amount
    return {
        "total_expenses": str(total_expenses),
        "entries": [{"category": category, "amount": str(_money(amount))} for category, amount in sorted(by_category.items())],
    }


@router.get("/inventory")
def inventory_report(
    store_id: str | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    balances = _filtered_inventory(membership, db, store_id)
    low_stock_items = []
    total_quantity = Decimal("0")
    total_stock_value = Decimal("0")
    total_retail_value = Decimal("0")
    out_of_stock_variants = 0
    for balance in balances:
        variant = db.query(ProductVariant).filter(ProductVariant.id == balance.variant_id).first()
        if not variant:
            continue
        product = db.query(Product).filter(Product.id == variant.product_id).first()
        quantity = Decimal(str(balance.quantity))
        total_quantity += quantity
        unit_cost = Decimal(str(balance.average_cost or 0))
        total_stock_value += quantity * unit_cost
        total_retail_value += quantity * Decimal(str(variant.selling_price or 0))
        if quantity <= 0:
            out_of_stock_variants += 1
        if quantity <= Decimal(str(variant.low_stock_threshold or 0)):
            low_stock_items.append({
                "variant_id": variant.id,
                "product_name": product.name if product else variant.name,
                "sku": variant.sku,
                "quantity": str(quantity),
                "reorder_level": str(variant.low_stock_threshold or 0),
                "stock_value": str(quantity * unit_cost),
            })
    return InventoryReportOut(
        total_variants=len(balances),
        total_quantity=_money(total_quantity),
        total_stock_value=_money(total_stock_value),
        total_retail_value=_money(total_retail_value),
        out_of_stock_variants=out_of_stock_variants,
        low_stock_items=[
            {
                "variant_id": item["variant_id"],
                "product_name": item["product_name"],
                "sku": item["sku"],
                "quantity": _money(item["quantity"]),
                "reorder_level": _money(item["reorder_level"]),
                "stock_value": _money(item["stock_value"]),
            }
            for item in low_stock_items
        ],
    )


@router.get("/customers")
def customer_debt_report(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    customers = db.query(Customer).filter(Customer.business_id == membership.business_id, Customer.is_active.is_(True)).all()
    rows = []
    total_outstanding = Decimal("0")
    overdue = 0
    for customer in customers:
        outstanding = (
            db.query(func.coalesce(func.sum(CustomerLedgerEntry.amount), Decimal("0")))
            .filter(
                CustomerLedgerEntry.business_id == membership.business_id,
                CustomerLedgerEntry.customer_id == customer.id,
            )
            .scalar()
        )
        outstanding = _safe_decimal(outstanding or 0)
        total_outstanding += outstanding
        if outstanding > 0:
            overdue += 1
        ledger = (
            db.query(CustomerLedgerEntry)
            .filter(
                CustomerLedgerEntry.business_id == membership.business_id,
                CustomerLedgerEntry.customer_id == customer.id,
            )
            .order_by(CustomerLedgerEntry.created_at.asc())
            .all()
        )
        aging = [Decimal("0"), Decimal("0"), Decimal("0")]
        payments = []
        now = datetime.now(timezone.utc)
        for entry in ledger:
            amount = Decimal(str(entry.amount))
            if amount > 0:
                created_at = entry.created_at
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                days_old = max(0, (now - created_at).days)
                bucket = 0 if days_old <= 7 else 1 if days_old <= 30 else 2
                aging[bucket] += amount
            elif amount < 0:
                payments.append(-amount)
        for payment in payments:
            remaining = payment
            for bucket in (2, 1, 0):
                applied = min(aging[bucket], remaining)
                aging[bucket] -= applied
                remaining -= applied
                if remaining <= 0:
                    break
        rows.append({
            "customer_id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "outstanding_balance": str(outstanding),
            "aging": [str(_money(amount)) for amount in aging],
        })
    return DebtorReportOut(
        customer_count=len(customers),
        total_outstanding=_money(total_outstanding),
        overdue_customers=overdue,
        customers=[{**row, "outstanding_balance": str(_money(row["outstanding_balance"]))} for row in rows],
    )


@router.get("/suppliers")
def supplier_report(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    suppliers = db.query(Supplier).filter(Supplier.business_id == membership.business_id).all()
    rows = []
    total_payables = Decimal("0")
    for supplier in suppliers:
        purchases_total = (
            db.query(func.coalesce(func.sum(Purchase.total_amount), Decimal("0")))
            .filter(
                Purchase.business_id == membership.business_id,
                Purchase.supplier_id == supplier.id,
                Purchase.status == "received",
            )
            .scalar()
        )
        payments_total = (
            db.query(func.coalesce(func.sum(SupplierPayment.amount), Decimal("0")))
            .filter(
                SupplierPayment.business_id == membership.business_id,
                SupplierPayment.supplier_id == supplier.id,
                SupplierPayment.reversal_of_id.is_(None),
            )
            .scalar()
        )
        payable = _safe_decimal(purchases_total or 0) - _safe_decimal(payments_total or 0)
        total_payables += payable
        rows.append({
            "supplier_id": supplier.id,
            "name": supplier.name,
            "payable_balance": str(payable),
        })
    return SupplierReportOut(
        supplier_count=len(suppliers),
        total_payables=_money(total_payables),
        suppliers=[{**row, "payable_balance": str(_money(row["payable_balance"]))} for row in rows],
    )


@router.get("/products/best-selling")
def best_selling_products(
    store_id: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    sales = _filtered_sales(membership, db, store_id, None, None)
    grouped = {}
    for sale in sales:
        for item in sale.items:
            grouped[item.variant_id] = grouped.get(item.variant_id, Decimal("0")) + Decimal(str(item.quantity))
    rows = []
    for variant_id, qty in sorted(grouped.items(), key=lambda pair: pair[1], reverse=True)[:limit]:
        variant = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
        if not variant:
            continue
        product = db.query(Product).filter(Product.id == variant.product_id).first()
        rows.append({
            "variant_id": variant.id,
            "product_name": product.name if product else variant.name,
            "sku": variant.sku,
            "quantity_sold": str(qty),
        })
    return rows


@router.get("/products/slow-moving")
def slow_moving_products(
    store_id: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    sales = _filtered_sales(membership, db, store_id, None, None)
    grouped = {}
    for sale in sales:
        for item in sale.items:
            grouped[item.variant_id] = grouped.get(item.variant_id, Decimal("0")) + Decimal(str(item.quantity))
    balances = {
        row.variant_id: Decimal(str(row.quantity))
        for row in _filtered_inventory(membership, db, store_id)
    }
    rows = []
    for variant_id, qty in sorted(grouped.items(), key=lambda pair: pair[1])[:limit]:
        variant = db.query(ProductVariant).filter(ProductVariant.id == variant_id).first()
        if not variant:
            continue
        product = db.query(Product).filter(Product.id == variant.product_id).first()
        rows.append({
            "variant_id": variant.id,
            "product_name": product.name if product else variant.name,
            "sku": variant.sku,
            "quantity_sold": str(qty),
            "quantity_in_stock": str(balances.get(variant_id, Decimal("0"))),
        })
    return rows


@router.get("/products/low-stock")
def low_stock_products(
    store_id: str | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    balances = _filtered_inventory(membership, db, store_id)
    rows = []
    for balance in balances:
        variant = db.query(ProductVariant).filter(ProductVariant.id == balance.variant_id).first()
        if not variant:
            continue
        product = db.query(Product).filter(Product.id == variant.product_id).first()
        quantity = Decimal(str(balance.quantity))
        if quantity <= Decimal(str(variant.low_stock_threshold or 0)):
            rows.append({
                "variant_id": variant.id,
                "product_name": product.name if product else variant.name,
                "sku": variant.sku,
                "quantity": str(quantity),
                "reorder_level": str(variant.low_stock_threshold or 0),
            })
    return rows


@router.get("/store-performance")
def store_performance_report(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    stores = db.query(Store).filter(Store.business_id == membership.business_id, Store.is_active.is_(True)).all()
    rows = []
    for store in stores:
        if membership.role != "owner" and store.id not in (membership.store_access or []):
            continue
        sales = _filtered_sales(membership, db, store.id, start_date, end_date)
        cashbook_entries = _filtered_cashbook(membership, db, store.id, start_date, end_date)
        sales_total = sum((sale.total_amount for sale in sales), Decimal("0"))
        expense_total = sum((entry.amount for entry in cashbook_entries if entry.direction == "out"), Decimal("0"))
        cash_total = sum((entry.amount for entry in cashbook_entries if entry.direction == "in"), Decimal("0"))
        rows.append({
            "store_id": store.id,
            "store_name": store.name,
            "sales_total": str(sales_total),
            "expense_total": str(expense_total),
            "net_cash": str(cash_total - expense_total),
            "transaction_count": len(sales),
        })
    return rows


@router.get("/export/csv")
def export_csv(
    report: str = Query(default="sales"),
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    if report == "sales":
        sales = _filtered_sales(membership, db, store_id, start_date, end_date)
        rows = [["sale_id", "store_id", "sale_number", "total_amount", "status", "created_at"]]
        for sale in sales:
            rows.append([sale.id, sale.store_id, sale.sale_number, str(sale.total_amount), sale.status, sale.created_at.isoformat()])
    elif report == "inventory":
        balances = _filtered_inventory(membership, db, store_id)
        rows = [["variant_id", "store_id", "quantity", "average_cost"]]
        for balance in balances:
            rows.append([balance.variant_id, balance.store_id, str(balance.quantity), str(balance.average_cost)])
    elif report == "customers":
        customers = db.query(Customer).filter(Customer.business_id == membership.business_id, Customer.is_active.is_(True)).all()
        rows = [["customer_id", "name", "phone", "outstanding_balance"]]
        for customer in customers:
            balance = (
                db.query(func.coalesce(func.sum(CustomerLedgerEntry.amount), Decimal("0")))
                .filter(
                    CustomerLedgerEntry.business_id == membership.business_id,
                    CustomerLedgerEntry.customer_id == customer.id,
                )
                .scalar()
            )
            rows.append([customer.id, customer.name, customer.phone or "", str(balance or 0)])
    elif report == "suppliers":
        suppliers = db.query(Supplier).filter(Supplier.business_id == membership.business_id).all()
        rows = [["supplier_id", "name", "payable_balance"]]
        for supplier in suppliers:
            purchase_total = (
                db.query(func.coalesce(func.sum(Purchase.total_amount), Decimal("0")))
                .filter(
                    Purchase.business_id == membership.business_id,
                    Purchase.supplier_id == supplier.id,
                    Purchase.status == "received",
                )
                .scalar()
            )
            payments_total = (
                db.query(func.coalesce(func.sum(SupplierPayment.amount), Decimal("0")))
                .filter(SupplierPayment.business_id == membership.business_id, SupplierPayment.supplier_id == supplier.id, SupplierPayment.reversal_of_id.is_(None))
                .scalar()
            )
            rows.append([supplier.id, supplier.name, str((_safe_decimal(purchase_total or 0) - _safe_decimal(payments_total or 0)))])
    else:
        raise HTTPException(status_code=400, detail="Unsupported report type for CSV export.")

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerows(rows)
    content = buffer.getvalue().encode("utf-8")
    return Response(content=content, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={report}-report.csv"})


@router.get("/export/pdf")
def export_pdf(
    report: str = Query(default="sales"),
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    if report == "sales":
        payload = sales_report(store_id=store_id, start_date=start_date, end_date=end_date, membership=membership, db=db)
        lines = [
            "ShopFlow Sales Report",
            f"Total sales: {payload.total_sales}",
            f"Total refunds: {payload.total_refunds}",
            f"Net sales: {payload.net_sales}",
            f"Transactions: {payload.total_transactions}",
        ]
    elif report == "inventory":
        payload = inventory_report(store_id=store_id, membership=membership, db=db)
        lines = [
            "ShopFlow Inventory Report",
            f"Total variants: {payload.total_variants}",
            f"Total quantity: {payload.total_quantity}",
            f"Total stock value: {payload.total_stock_value}",
            f"Low stock items: {len(payload.low_stock_items)}",
        ]
    else:
        raise HTTPException(status_code=400, detail="Unsupported report type for PDF export.")

    pdf_lines = [
        "BT /F1 12 Tf 50 760 Td (ShopFlow Report) Tj ET",
    ]
    y = 740
    for text in lines:
        pdf_lines.append(f"BT /F1 12 Tf 50 {y} Td ({_escape_pdf_text(text)}) Tj ET")
        y -= 18
    content_stream = "\n".join(pdf_lines).encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content_stream)} >>\nstream\n{content_stream.decode('latin-1')}\nendstream".encode("latin-1"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode("latin-1"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return Response(content=bytes(pdf), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={report}-report.pdf"})
