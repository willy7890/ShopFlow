import hmac
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, is_trusted_super_admin, require_roles
from app.modules.auth.models import User
from app.modules.catalog.models import Product
from app.modules.businesses.models import Business, Membership, Store
from app.modules.customers.models import Customer
from app.modules.finance.models import CashbookEntry
from app.modules.inventory.models import Purchase, SupplierPayment
from app.modules.sales.models import Sale, SaleItem, SaleRefund
from app.modules.subscriptions.models import BusinessSubscription, SubscriptionAuditLog, SubscriptionPayment, SubscriptionPaymentMethodSetting, SubscriptionPlan
from app.modules.subscriptions.schemas import (
    AdminBusinessOut,
    AdminBusinessDetailOut,
    AdminBusinessUpdate,
    AdminSubscriptionGrant,
    BusinessStatusUpdate,
    BusinessSubscriptionOut,
    EntitlementsOut,
    GlobalReportOut,
    PlatformAnalyticsOut,
    PlatformCurrencyTotals,
    PlatformSubscriptionOut,
    PlatformSubscriptionUpdate,
    PlatformStoreOut,
    PlatformUserOut,
    PlatformUserDetailOut,
    PlatformUserBusinessOut,
    SubscriptionPaymentCreate,
    SubscriptionPaymentStatusUpdate,
    SubscriptionPaymentOut,
    PlatformRevenueOut,
    RevenuePeriodOut,
    RevenueByPlanOut,
    StoreCreate,
    StoreStatusUpdate,
    SubscriptionAuditOut,
    SubscriptionPlanCreate,
    SubscriptionPlanOut,
    SubscriptionPlanUpdate,
    SubscriptionRequest,
    BusinessGrowthPoint,
    CustomerPaymentSubmission,
    InitialPaidPlansResult,
    PaymentInstructionsOut,
    PaymentMethodSettingInput,
    PaymentMethodSettingOut,
    SuperAdminReconciliationRequest,
    UserStatusUpdate,
    PlanArchiveRequest,
)

router = APIRouter()


def _require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if not is_trusted_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Super admin access is required.")
    return current_user


def _platform_user_businesses(db: Session, user: User) -> list[PlatformUserBusinessOut]:
    rows = (
        db.query(Membership, Business)
        .join(Business, Business.id == Membership.business_id)
        .filter(Membership.user_id == user.id)
        .order_by(Business.name)
        .all()
    )
    result = []
    for membership, business in rows:
        subscription = _latest_subscription(db, business.id)
        plan = db.get(SubscriptionPlan, subscription.plan_id) if subscription and subscription.plan_id else None
        result.append(PlatformUserBusinessOut(
            business_id=business.id,
            business_name=business.name,
            business_is_active=business.is_active,
            role=membership.role,
            membership_is_active=membership.is_active,
            subscription_status=(
                "expired" if subscription and subscription.status in {"active", "trial"} and not _subscription_is_current(subscription)
                else subscription.status if subscription else None
            ),
            subscription_expires_at=subscription.expires_at if subscription else None,
            plan_id=plan.id if plan else None,
            plan_name=plan.name if plan else None,
        ))
    return result


def _platform_user_out(db: Session, user: User) -> PlatformUserOut:
    return PlatformUserOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        is_active=user.is_active,
        is_super_admin=user.is_super_admin,
        is_email_verified=user.is_email_verified,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        businesses=_platform_user_businesses(db, user),
    )


def _platform_payment_out(db: Session, payment: SubscriptionPayment) -> SubscriptionPaymentOut:
    business = db.get(Business, payment.business_id)
    plan = db.get(SubscriptionPlan, payment.plan_id) if payment.plan_id else None
    return SubscriptionPaymentOut(
        **{column.name: getattr(payment, column.name) for column in SubscriptionPayment.__table__.columns},
        business_name=business.name if business else "",
        plan_name=plan.name if plan else None,
    )


def _audit(
    db: Session,
    actor: User,
    event_type: str,
    *,
    business_id: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        SubscriptionAuditLog(
            business_id=business_id,
            user_id=actor.id,
            event_type=event_type,
            details=details or {},
        )
    )


def _latest_subscription(db: Session, business_id: str) -> BusinessSubscription | None:
    return (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == business_id)
        .order_by(BusinessSubscription.created_at.desc(), BusinessSubscription.id.desc())
        .first()
    )


def _admin_subscription(subscription: BusinessSubscription | None) -> BusinessSubscriptionOut | None:
    if not subscription:
        return None
    out = BusinessSubscriptionOut.model_validate(subscription)
    status = "expired" if subscription.status in {"active", "trial"} and not _subscription_is_current(subscription) else subscription.status
    return out.model_copy(update={"effective_status": status})


def _effective_subscription(db: Session, business_id: str) -> BusinessSubscription | None:
    now = datetime.now(timezone.utc)
    candidates = (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == business_id, BusinessSubscription.status.in_(["active", "trial"]))
        .order_by(BusinessSubscription.created_at.desc())
        .all()
    )
    for subscription in candidates:
        expiry = subscription.expires_at
        if expiry is None:
            return subscription
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry > now:
            return subscription
    return None


def _subscription_is_current(subscription: BusinessSubscription | None) -> bool:
    if not subscription or subscription.status not in {"active", "trial"}:
        return False
    if subscription.expires_at is None:
        return True
    expires_at = subscription.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > datetime.now(timezone.utc)


def _platform_currency_totals(
    db: Session,
    businesses: list[Business],
    start_date: date | None = None,
    end_date: date | None = None,
) -> tuple[list[PlatformCurrencyTotals], int]:
    totals: dict[str, dict[str, Decimal | int | bool]] = {}
    transaction_count = 0
    for business in businesses:
        currency = business.currency
        row = totals.setdefault(currency, {
            "sales": Decimal("0"), "refunds": Decimal("0"), "cogs": Decimal("0"),
            "expenses": Decimal("0"), "debt": Decimal("0"), "supplier_liabilities": Decimal("0"),
            "transactions": 0, "has_unknown_cogs": False,
        })
        sales_query = db.query(Sale).filter(Sale.business_id == business.id)
        if start_date:
            sales_query = sales_query.filter(func.date(Sale.created_at) >= start_date.isoformat())
        if end_date:
            sales_query = sales_query.filter(func.date(Sale.created_at) <= end_date.isoformat())
        sales = sales_query.all()
        sale_ids = [sale.id for sale in sales]
        gross_sales = sum((Decimal(str(sale.total_amount)) for sale in sales), Decimal("0"))
        refunds = Decimal("0")
        cogs = Decimal("0")
        has_unknown_cogs = False
        if sale_ids:
            refunds = Decimal(str(db.query(func.coalesce(func.sum(SaleRefund.amount), 0)).filter(SaleRefund.sale_id.in_(sale_ids)).scalar() or 0))
            cost_rows = db.query(SaleItem.unit_cost, SaleItem.quantity).filter(SaleItem.sale_id.in_(sale_ids)).all()
            for unit_cost, quantity in cost_rows:
                if unit_cost is None:
                    has_unknown_cogs = True
                else:
                    cogs += Decimal(str(unit_cost)) * Decimal(str(quantity))
        expense_query = db.query(func.coalesce(func.sum(CashbookEntry.amount), 0)).filter(
            CashbookEntry.business_id == business.id,
            CashbookEntry.direction == "out",
            CashbookEntry.reversal_of_id.is_(None),
        )
        if start_date:
            expense_query = expense_query.filter(func.date(CashbookEntry.created_at) >= start_date.isoformat())
        if end_date:
            expense_query = expense_query.filter(func.date(CashbookEntry.created_at) <= end_date.isoformat())
        expenses = Decimal(str(expense_query.scalar() or 0))
        debt = Decimal(str(db.query(func.coalesce(func.sum(Customer.outstanding_balance), 0)).filter(
            Customer.business_id == business.id,
            Customer.is_active.is_(True),
        ).scalar() or 0))
        purchases = Decimal(str(db.query(func.coalesce(func.sum(Purchase.total_amount), 0)).filter(
            Purchase.business_id == business.id,
            Purchase.status == "received",
        ).scalar() or 0))
        supplier_payments = Decimal(str(db.query(func.coalesce(func.sum(SupplierPayment.amount), 0)).filter(
            SupplierPayment.business_id == business.id,
            SupplierPayment.reversal_of_id.is_(None),
        ).scalar() or 0))

        row["sales"] = Decimal(row["sales"]) + gross_sales
        row["refunds"] = Decimal(row["refunds"]) + refunds
        row["cogs"] = Decimal(row["cogs"]) + cogs
        row["expenses"] = Decimal(row["expenses"]) + expenses
        row["debt"] = Decimal(row["debt"]) + debt
        row["supplier_liabilities"] = Decimal(row["supplier_liabilities"]) + purchases - supplier_payments
        row["transactions"] = int(row["transactions"]) + len(sales)
        row["has_unknown_cogs"] = bool(row["has_unknown_cogs"]) or has_unknown_cogs
        transaction_count += len(sales)

    currency_totals = []
    for currency, row in sorted(totals.items()):
        net_sales = Decimal(row["sales"]) - Decimal(row["refunds"])
        currency_totals.append(PlatformCurrencyTotals(
            currency=currency,
            sales_revenue=net_sales,
            expenses=Decimal(row["expenses"]),
            gross_profit=None if row["has_unknown_cogs"] else net_sales - Decimal(row["cogs"]),
            outstanding_debt=Decimal(row["debt"]),
            supplier_liabilities=Decimal(row["supplier_liabilities"]),
            transaction_count=int(row["transactions"]),
        ))
    return currency_totals, transaction_count


@router.post("/admin/bootstrap", status_code=200)
def bootstrap_super_admin(
    bootstrap_secret: str = Header(..., alias="X-Super-Admin-Bootstrap-Secret"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    configured_secret = settings.SUPER_ADMIN_BOOTSTRAP_SECRET
    configured_email = settings.SUPER_ADMIN_EMAIL.strip().casefold()
    if not configured_secret or not configured_email:
        raise HTTPException(status_code=503, detail="Super admin bootstrap is not configured.")
    if not hmac.compare_digest(bootstrap_secret, configured_secret):
        raise HTTPException(status_code=403, detail="Invalid bootstrap credentials.")
    if current_user.email.strip().casefold() != configured_email:
        raise HTTPException(status_code=403, detail="This account is not the configured super admin.")
    if not current_user.is_email_verified:
        raise HTTPException(status_code=403, detail="The configured super admin email must be verified before activation.")
    other_admin = (
        db.query(User)
        .filter(User.is_super_admin.is_(True), User.id != current_user.id)
        .first()
    )
    if other_admin:
        raise HTTPException(status_code=409, detail="A super admin is already configured.")
    if current_user.is_super_admin:
        return {"is_super_admin": True}
    current_user.is_super_admin = True
    _audit(db, current_user, "super_admin_bootstrapped", details={"email": current_user.email})
    db.commit()
    return {"is_super_admin": True}


@router.post("/admin/reconcile-primary", status_code=200)
def reconcile_primary_super_admin(
    payload: SuperAdminReconciliationRequest,
    bootstrap_secret: str = Header(..., alias="X-Super-Admin-Bootstrap-Secret"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Recover the configured owner when an unverified legacy flag blocks bootstrap.

    This is deliberately narrower than a general ownership transfer. It is
    authorized by the configured recovery secret and the verified, configured
    destination account, and only demotes one unverified, differently named flag.
    """
    configured_secret = settings.SUPER_ADMIN_BOOTSTRAP_SECRET
    configured_email = settings.SUPER_ADMIN_EMAIL.strip().casefold()
    if not configured_secret or not configured_email:
        raise HTTPException(status_code=503, detail="Super admin recovery is not configured.")
    if not hmac.compare_digest(bootstrap_secret, configured_secret):
        raise HTTPException(status_code=403, detail="Invalid recovery credentials.")
    if current_user.email.strip().casefold() != configured_email:
        raise HTTPException(status_code=403, detail="This account is not the configured primary Super Admin.")
    if not current_user.is_email_verified:
        raise HTTPException(status_code=403, detail="The primary Super Admin email must be verified.")
    if payload.confirm_primary_email != configured_email:
        raise HTTPException(status_code=422, detail="Primary email confirmation does not match configuration.")

    admins = (
        db.query(User)
        .filter(User.is_super_admin.is_(True))
        .with_for_update()
        .all()
    )
    foreign_admins = [user for user in admins if user.id != current_user.id]
    if len(foreign_admins) > 1:
        raise HTTPException(status_code=409, detail="Multiple existing Super Admin records require manual review.")

    previous_admin = foreign_admins[0] if foreign_admins else None
    if previous_admin:
        if previous_admin.email.strip().casefold() != payload.existing_admin_email:
            raise HTTPException(status_code=409, detail="Existing Super Admin identity confirmation does not match.")
        if previous_admin.is_email_verified:
            raise HTTPException(status_code=409, detail="A verified existing Super Admin requires a separately authorized transfer.")
        previous_admin.is_super_admin = False
        # Apply the demotion before promotion to satisfy the unique partial index
        # while keeping both changes in the same transaction.
        db.flush()

    current_user.is_super_admin = True
    _audit(
        db,
        current_user,
        "super_admin_identity_reconciled",
        details={
            "primary_email": current_user.email,
            "previous_admin_user_id": previous_admin.id if previous_admin else None,
            "previous_admin_email": previous_admin.email if previous_admin else None,
            "reason": payload.reason.strip(),
        },
    )
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Super Admin ownership changed concurrently; retry after review.") from error
    return {"is_super_admin": True}


@router.get("/plans", response_model=list[SubscriptionPlanOut])
def list_plans(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    query = db.query(SubscriptionPlan)
    if active_only:
        query = query.filter(SubscriptionPlan.is_active.is_(True))
    return query.order_by(SubscriptionPlan.price, SubscriptionPlan.name).all()


@router.post("/admin/plans", response_model=SubscriptionPlanOut, status_code=201)
def create_plan(
    payload: SubscriptionPlanCreate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if db.query(SubscriptionPlan).filter(SubscriptionPlan.slug == payload.slug).first():
        raise HTTPException(status_code=409, detail="A plan with this slug already exists.")
    plan = SubscriptionPlan(**payload.model_dump(), entitlement_schema_version=1)
    db.add(plan)
    _audit(db, admin, "subscription_plan_created", details={"slug": plan.slug, "name": plan.name, "currency": plan.currency})
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/admin/plans/ensure-initial-tzs", response_model=InitialPaidPlansResult)
def ensure_initial_tzs_plans(
    payload: PlanArchiveRequest,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    """Create missing starter TZS plans without altering any existing plan."""
    specs = [
        {
            "slug": "basic-tzs-10000", "name": "Basic", "description": "Monthly core sales, products, inventory, and customer tools.", "price": Decimal("10000.00"),
            "features": {"dashboard": True, "sales_pos": True, "product_management": True, "product_categories": True, "inventory": True, "customers": True, "max_users": 3, "max_employees": 2, "max_stores": 1, "max_products": 100},
        },
        {
            "slug": "standard-tzs-20000", "name": "Standard", "description": "Monthly core operations with orders, supplier tools, debts, finance, and detailed reports.", "price": Decimal("20000.00"),
            "features": {"dashboard": True, "sales_pos": True, "orders": True, "product_management": True, "product_categories": True, "inventory": True, "stock_alerts": True, "invoices": True, "customers": True, "customer_debtors": True, "supplier_management": True, "supplier_payments": True, "cashbook": True, "financial_reports": True, "sales_reports": True, "profit_reports": True, "inventory_reports": True, "employee_management": True, "csv_exports": True, "max_users": 10, "max_employees": 8, "max_stores": 3, "max_products": 1000},
        },
        {
            "slug": "premium-tzs-35000", "name": "Premium", "description": "Monthly full operations with multi-store management, analytics, and data exports.", "price": Decimal("35000.00"),
            "features": {"dashboard": True, "sales_pos": True, "orders": True, "product_management": True, "product_categories": True, "inventory": True, "stock_alerts": True, "invoices": True, "customers": True, "customer_debtors": True, "supplier_management": True, "supplier_payments": True, "cashbook": True, "financial_reports": True, "sales_reports": True, "profit_reports": True, "inventory_reports": True, "employee_management": True, "advanced_permissions": True, "multi_store": True, "advanced_analytics": True, "csv_exports": True, "pdf_exports": True, "offline_sync": True, "max_users": 50, "max_employees": 50, "max_stores": 10, "max_products": 10000},
        },
    ]
    created: list[str] = []
    unchanged: list[str] = []
    for spec in specs:
        existing = db.query(SubscriptionPlan).filter(SubscriptionPlan.slug == spec["slug"]).first()
        if existing:
            unchanged.append(spec["slug"])
            continue
        db.add(SubscriptionPlan(
            **spec, currency="TZS", duration_days=30, trial_days=0, is_active=True,
            entitlement_schema_version=1,
        ))
        created.append(spec["slug"])
    _audit(db, admin, "initial_tzs_plans_ensured", details={
        "created_slugs": created,
        "unchanged_slugs": unchanged,
        "reason": payload.reason.strip(),
    })
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        existing_slugs = {slug for (slug,) in db.query(SubscriptionPlan.slug).filter(SubscriptionPlan.slug.in_([spec["slug"] for spec in specs])).all()}
        if len(existing_slugs) != len(specs):
            raise HTTPException(status_code=409, detail="A plan changed concurrently; retry after reviewing the plan list.") from error
        unchanged = [spec["slug"] for spec in specs]
        created = []
    plans_by_slug = {plan.slug: plan for plan in db.query(SubscriptionPlan).filter(SubscriptionPlan.slug.in_([spec["slug"] for spec in specs])).all()}
    return InitialPaidPlansResult(
        plans=[plans_by_slug[spec["slug"]] for spec in specs],
        created_slugs=created,
        unchanged_slugs=unchanged,
    )


@router.patch("/admin/plans/{plan_id}", response_model=SubscriptionPlanOut)
def update_plan(
    plan_id: str,
    payload: SubscriptionPlanUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    plan = db.get(SubscriptionPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Subscription plan not found.")
    if plan.archived_at:
        raise HTTPException(status_code=409, detail="Archived plans cannot be edited.")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(plan, field, value)
    if "features" in changes:
        plan.entitlement_schema_version = 1
    _audit(
        db,
        admin,
        "subscription_plan_updated",
        details={"plan_id": plan.id, "changed_fields": sorted(payload.model_dump(exclude_unset=True))},
    )
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/admin/plans/{plan_id}/archive", response_model=SubscriptionPlanOut)
def archive_plan(
    plan_id: str,
    payload: PlanArchiveRequest,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    plan = db.get(SubscriptionPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Subscription plan not found.")
    if not plan.archived_at:
        plan.archived_at = datetime.now(timezone.utc)
        plan.is_active = False
        _audit(db, admin, "subscription_plan_archived", details={
            "plan_id": plan.id,
            "reason": payload.reason,
        })
        db.commit()
        db.refresh(plan)
    return plan


@router.get("/admin/plans/{plan_id}/businesses", response_model=list[AdminBusinessOut])
def list_plan_businesses(
    plan_id: str,
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if not db.get(SubscriptionPlan, plan_id):
        raise HTTPException(status_code=404, detail="Subscription plan not found.")
    rows = (
        db.query(BusinessSubscription, Business)
        .join(Business, Business.id == BusinessSubscription.business_id)
        .filter(
            BusinessSubscription.plan_id == plan_id,
            BusinessSubscription.status.in_(["active", "trial", "pending", "suspended"]),
        )
        .order_by(BusinessSubscription.created_at.desc(), Business.name)
        .all()
    )
    results = []
    seen_businesses: set[str] = set()
    for subscription, business in rows:
        if business.id in seen_businesses:
            continue
        seen_businesses.add(business.id)
        results.append(AdminBusinessOut(
            id=business.id,
            name=business.name,
            business_type=business.business_type,
            currency=business.currency,
            is_active=business.is_active,
            created_at=business.created_at,
            subscription=_admin_subscription(subscription),
        ))
    return results


@router.post("/request", response_model=BusinessSubscriptionOut, status_code=201)
def request_subscription(
    payload: SubscriptionRequest,
    membership: Membership = Depends(require_roles("owner", "business_manager")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = (
        db.query(SubscriptionPlan)
        .filter(SubscriptionPlan.id == payload.plan_id, SubscriptionPlan.is_active.is_(True))
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Active subscription plan not found.")
    if plan.entitlement_schema_version < 1:
        raise HTTPException(status_code=409, detail="This plan needs explicit entitlement review before it can be assigned to a new subscription.")
    business = db.get(Business, membership.business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    if plan.currency != business.currency:
        raise HTTPException(status_code=422, detail="Plan currency must match the business currency.")
    current = _latest_subscription(db, membership.business_id)
    if current and current.status == "pending" and current.plan_id == plan.id:
        raise HTTPException(status_code=409, detail="A request for this plan is already pending.")

    now = datetime.now(timezone.utc)
    is_free_plan = plan.price == Decimal("0.00")
    is_trial = not is_free_plan and plan.trial_days > 0
    starts_immediately = is_free_plan or is_trial
    subscription = BusinessSubscription(
        business_id=membership.business_id,
        plan_id=plan.id,
        status="trial" if is_trial else "active" if is_free_plan else "pending",
        started_at=now,
        expires_at=now + timedelta(days=plan.trial_days if is_trial else plan.duration_days) if starts_immediately else None,
        renewal_price=plan.price,
        currency=plan.currency,
        entitlement_mode="enforced",
    )
    if starts_immediately:
        (
            db.query(BusinessSubscription)
            .filter(
                BusinessSubscription.business_id == membership.business_id,
                BusinessSubscription.status.in_(["active", "trial", "pending"]),
            )
            .update({"status": "superseded"}, synchronize_session=False)
        )
    db.add(subscription)
    db.flush()
    _audit(
        db,
        current_user,
        "subscription_requested",
        business_id=membership.business_id,
        details={"subscription_id": subscription.id, "plan_id": plan.id, "status": subscription.status},
    )
    db.commit()
    db.refresh(subscription)
    return subscription


@router.get("/current", response_model=BusinessSubscriptionOut | None)
def get_current_subscription(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    return _effective_subscription(db, membership.business_id) or _latest_subscription(db, membership.business_id)


@router.get("/payment-instructions", response_model=PaymentInstructionsOut)
def get_subscription_payment_instructions(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    business = db.get(Business, membership.business_id)
    methods = db.query(SubscriptionPaymentMethodSetting).filter(
        SubscriptionPaymentMethodSetting.currency == (business.currency if business else ""),
        SubscriptionPaymentMethodSetting.is_active.is_(True),
    ).order_by(SubscriptionPaymentMethodSetting.display_name).all()
    summary = "\n\n".join(
        f"{method.display_name}: {method.recipient_name} · {method.recipient_details}\n{method.reference_instructions}"
        for method in methods
    )
    return PaymentInstructionsOut(
        currency=business.currency if business else "",
        instructions=summary,
        configured=bool(methods),
        methods=methods,
    )


@router.get("/admin/payment-settings", response_model=list[PaymentMethodSettingOut])
def list_payment_settings(
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    return db.query(SubscriptionPaymentMethodSetting).order_by(
        SubscriptionPaymentMethodSetting.currency,
        SubscriptionPaymentMethodSetting.method,
    ).all()


@router.patch("/admin/payment-settings/{currency}/{method}", response_model=PaymentMethodSettingOut)
def update_payment_setting(
    currency: str,
    method: Literal["manual", "mobile_money", "bank", "cash"],
    payload: PaymentMethodSettingInput,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    currency = currency.upper()
    if len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise HTTPException(status_code=422, detail="Currency must be a three-letter code.")
    setting = db.query(SubscriptionPaymentMethodSetting).filter(
        SubscriptionPaymentMethodSetting.currency == currency,
        SubscriptionPaymentMethodSetting.method == method,
    ).first()
    created = setting is None
    if setting is None:
        setting = SubscriptionPaymentMethodSetting(currency=currency, method=method)
        db.add(setting)
    for field, value in payload.model_dump(exclude={"reason"}).items():
        setattr(setting, field, value)
    setting.updated_by_user_id = admin.id
    db.flush()
    _audit(db, admin, "subscription_payment_method_configured", details={
        "currency": currency,
        "method": method,
        "created": created,
        "is_active": setting.is_active,
        "recipient_changed": True,
        "reason": payload.reason.strip(),
    })
    db.commit()
    db.refresh(setting)
    return setting


@router.get("/payments/mine", response_model=list[SubscriptionPaymentOut])
def list_business_subscription_payments(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    payments = (
        db.query(SubscriptionPayment)
        .filter(SubscriptionPayment.business_id == membership.business_id)
        .order_by(SubscriptionPayment.paid_at.desc(), SubscriptionPayment.created_at.desc())
        .limit(100)
        .all()
    )
    return [_platform_payment_out(db, payment) for payment in payments]


@router.post("/payments/submit", response_model=SubscriptionPaymentOut, status_code=201)
def submit_business_subscription_payment(
    payload: CustomerPaymentSubmission,
    membership: Membership = Depends(require_roles("owner", "business_manager")),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscription = _latest_subscription(db, membership.business_id)
    if not subscription or subscription.status not in {"pending", "active", "trial"}:
        raise HTTPException(status_code=409, detail="There is no subscription awaiting a payment for this business.")
    business = db.get(Business, membership.business_id)
    configured_method = db.query(SubscriptionPaymentMethodSetting.id).filter(
        SubscriptionPaymentMethodSetting.currency == (business.currency if business else ""),
        SubscriptionPaymentMethodSetting.method == payload.payment_method,
        SubscriptionPaymentMethodSetting.is_active.is_(True),
    ).first()
    if not configured_method:
        raise HTTPException(status_code=409, detail="This payment method is not configured for the business currency.")
    reference = payload.transaction_reference.strip()
    if db.query(SubscriptionPayment.id).filter(SubscriptionPayment.transaction_reference == reference).first():
        raise HTTPException(status_code=409, detail="That payment reference is already recorded.")
    paid_at = payload.paid_at
    if paid_at.tzinfo is None:
        paid_at = paid_at.replace(tzinfo=timezone.utc)
    payment = SubscriptionPayment(
        business_id=membership.business_id,
        subscription_id=subscription.id,
        plan_id=subscription.plan_id,
        amount=subscription.renewal_price,
        currency=subscription.currency,
        payment_method=payload.payment_method,
        transaction_reference=reference,
        paid_at=paid_at,
        status="pending",
        confirmation_details="Submitted by the business for manual verification.",
    )
    db.add(payment)
    try:
        db.flush()
        _audit(db, current_user, "subscription_payment_submitted", business_id=membership.business_id, details={
            "payment_id": payment.id,
            "subscription_id": subscription.id,
            "amount": str(payment.amount),
            "currency": payment.currency,
            "payment_method": payment.payment_method,
            "transaction_reference": payment.transaction_reference,
            "status": payment.status,
        })
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="That payment reference is already recorded.") from error
    db.refresh(payment)
    return _platform_payment_out(db, payment)


@router.get("/history", response_model=list[BusinessSubscriptionOut])
def get_subscription_history(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    return (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == membership.business_id)
        .order_by(BusinessSubscription.created_at.desc())
        .all()
    )


@router.get("/entitlements", response_model=EntitlementsOut)
def get_entitlements(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    subscription = _effective_subscription(db, membership.business_id)
    plan = db.get(SubscriptionPlan, subscription.plan_id) if subscription and subscription.plan_id else None
    features: dict[str, bool | int | str] = {}
    if _subscription_is_current(subscription) and plan:
        features.update(plan.features or {})
        features.update(subscription.feature_overrides or {})
    return EntitlementsOut(subscription=subscription, plan=plan, features=features)


@router.get("/admin/businesses", response_model=list[AdminBusinessOut])
def list_platform_businesses(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    search: str | None = Query(default=None, max_length=120),
    is_active: bool | None = None,
    plan_id: str | None = None,
    subscription_status: Literal["active", "trial", "pending", "suspended", "cancelled", "superseded", "expired", "none"] | None = None,
    registered_from: date | None = None,
    registered_to: date | None = None,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if registered_from and registered_to and registered_from > registered_to:
        raise HTTPException(status_code=422, detail="registered_from must be on or before registered_to.")
    query = db.query(Business)
    if search and search.strip():
        needle = f"%{search.strip()}%"
        owner_business_ids = db.query(Membership.business_id).join(
            User, User.id == Membership.user_id,
        ).filter(
            Membership.role == "owner",
            or_(User.full_name.ilike(needle), User.email.ilike(needle)),
        )
        query = query.filter(or_(
            Business.name.ilike(needle),
            Business.id.ilike(needle),
            Business.id.in_(owner_business_ids),
        ))
    if is_active is not None:
        query = query.filter(Business.is_active.is_(is_active))
    if registered_from:
        query = query.filter(func.date(Business.created_at) >= registered_from.isoformat())
    if registered_to:
        query = query.filter(func.date(Business.created_at) <= registered_to.isoformat())
    latest_subscription = lambda column: db.query(getattr(BusinessSubscription, column)).filter(
        BusinessSubscription.business_id == Business.id,
    ).order_by(BusinessSubscription.created_at.desc(), BusinessSubscription.id.desc()).limit(1).scalar_subquery()
    latest_plan_id = latest_subscription("plan_id")
    latest_status = latest_subscription("status")
    latest_expiry = latest_subscription("expires_at")
    if plan_id:
        query = query.filter(latest_plan_id == plan_id)
    if subscription_status == "none":
        query = query.filter(latest_status.is_(None))
    elif subscription_status == "expired":
        query = query.filter(
            latest_status.in_(["active", "trial"]),
            latest_expiry.is_not(None),
            latest_expiry <= datetime.now(timezone.utc),
        )
    elif subscription_status in {"active", "trial"}:
        query = query.filter(
            latest_status == subscription_status,
            or_(latest_expiry.is_(None), latest_expiry > datetime.now(timezone.utc)),
        )
    elif subscription_status:
        query = query.filter(latest_status == subscription_status)
    businesses = query.order_by(Business.created_at.desc()).offset(offset).limit(limit).all()
    return [
        AdminBusinessOut(
            id=business.id,
            name=business.name,
            business_type=business.business_type,
            currency=business.currency,
            is_active=business.is_active,
            created_at=business.created_at,
            subscription=_admin_subscription(_latest_subscription(db, business.id)),
        )
        for business in businesses
    ]


@router.get("/admin/businesses/{business_id}", response_model=AdminBusinessDetailOut)
def get_platform_business(
    business_id: str,
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    owner_membership = (
        db.query(Membership)
        .filter(Membership.business_id == business.id, Membership.role == "owner", Membership.is_active.is_(True))
        .order_by(Membership.created_at.asc())
        .first()
    )
    owner = db.get(User, owner_membership.user_id) if owner_membership else None
    subscription = _latest_subscription(db, business.id)
    return AdminBusinessDetailOut(
        id=business.id,
        name=business.name,
        business_type=business.business_type,
        currency=business.currency,
        is_active=business.is_active,
        subscription=subscription,
        created_at=business.created_at,
        owner_user_id=owner.id if owner else None,
        owner_name=owner.full_name if owner else None,
        owner_email=owner.email if owner else None,
        store_count=db.query(func.count(Store.id)).filter(Store.business_id == business.id).scalar() or 0,
        employee_count=db.query(func.count(Membership.id)).filter(
            Membership.business_id == business.id,
            Membership.is_active.is_(True),
            Membership.role != "owner",
        ).scalar() or 0,
        user_count=db.query(func.count(Membership.id)).filter(
            Membership.business_id == business.id,
            Membership.is_active.is_(True),
        ).scalar() or 0,
        product_count=db.query(func.count(Product.id)).filter(Product.business_id == business.id).scalar() or 0,
        sales_count=db.query(func.count(Sale.id)).filter(Sale.business_id == business.id).scalar() or 0,
    )


@router.patch("/admin/businesses/{business_id}", response_model=AdminBusinessOut)
def update_platform_business(
    business_id: str,
    payload: AdminBusinessUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    changes = payload.model_dump(exclude_unset=True, exclude={"reason"})
    if "currency" in changes and changes["currency"] != business.currency:
        incompatible = db.query(func.count(BusinessSubscription.id)).filter(
            BusinessSubscription.business_id == business.id,
            BusinessSubscription.status.in_(["active", "trial", "pending"]),
            BusinessSubscription.currency != changes["currency"],
        ).scalar() or 0
        if incompatible:
            raise HTTPException(status_code=409, detail="Resolve existing subscription currencies before changing this business currency.")
    for field, value in changes.items():
        setattr(business, field, value.strip() if isinstance(value, str) else value)
    _audit(db, admin, "business_details_updated", business_id=business.id, details={
        "changed_fields": sorted(changes),
        "reason": payload.reason,
    })
    db.commit()
    db.refresh(business)
    return AdminBusinessOut(
        id=business.id,
        name=business.name,
        business_type=business.business_type,
        currency=business.currency,
        is_active=business.is_active,
        created_at=business.created_at,
        subscription=_admin_subscription(_latest_subscription(db, business.id)),
    )


@router.patch("/admin/businesses/{business_id}/status", response_model=AdminBusinessOut)
def update_business_status(
    business_id: str,
    payload: BusinessStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    business.is_active = payload.is_active
    _audit(
        db,
        admin,
        "business_status_changed",
        business_id=business.id,
        details={"is_active": payload.is_active, "reason": payload.reason},
    )
    db.commit()
    return AdminBusinessOut(
        id=business.id,
        name=business.name,
        business_type=business.business_type,
        currency=business.currency,
        is_active=business.is_active,
        created_at=business.created_at,
        subscription=_admin_subscription(_latest_subscription(db, business.id)),
    )


@router.get("/admin/users", response_model=list[PlatformUserOut])
def list_platform_users(
    search: str | None = Query(default=None, max_length=120),
    business_id: str | None = None,
    role: str | None = Query(default=None, max_length=40),
    is_active: bool | None = None,
    is_verified: bool | None = None,
    registered_from: date | None = None,
    registered_to: date | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if search and search.strip():
        needle = f"%{search.strip()}%"
        query = query.filter(or_(User.full_name.ilike(needle), User.email.ilike(needle), User.phone.ilike(needle)))
    if is_active is not None:
        query = query.filter(User.is_active.is_(is_active))
    if is_verified is not None:
        query = query.filter(User.is_email_verified.is_(is_verified))
    if registered_from:
        query = query.filter(func.date(User.created_at) >= registered_from.isoformat())
    if registered_to:
        query = query.filter(func.date(User.created_at) <= registered_to.isoformat())
    if business_id:
        query = query.filter(User.id.in_(db.query(Membership.user_id).filter(Membership.business_id == business_id)))
    if role:
        if role.casefold() == "super_admin":
            query = query.filter(User.is_super_admin.is_(True))
        else:
            query = query.filter(User.id.in_(db.query(Membership.user_id).filter(Membership.role == role)))
    users = query.order_by(User.created_at.desc(), User.id).offset(offset).limit(limit).all()
    return [_platform_user_out(db, user) for user in users]


@router.get("/admin/users/{user_id}", response_model=PlatformUserDetailOut)
def get_platform_user(
    user_id: str,
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return PlatformUserDetailOut(
        **_platform_user_out(db, user).model_dump(),
        audit_history=db.query(SubscriptionAuditLog)
        .filter(SubscriptionAuditLog.user_id == user.id)
        .order_by(SubscriptionAuditLog.created_at.desc())
        .limit(100)
        .all(),
    )


@router.patch("/admin/users/{user_id}/status", response_model=PlatformUserOut)
def update_user_status(
    user_id: str,
    payload: UserStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account.")
    if user.is_super_admin and not payload.is_active:
        remaining_admins = (
            db.query(func.count(User.id))
            .filter(User.is_super_admin.is_(True), User.is_active.is_(True), User.id != user.id)
            .scalar()
        )
        if not remaining_admins:
            raise HTTPException(status_code=409, detail="The last active super admin cannot be deactivated.")
    user.is_active = payload.is_active
    _audit(
        db,
        admin,
        "user_status_changed",
        details={"user_id": user.id, "is_active": payload.is_active, "reason": payload.reason},
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/admin/businesses/{business_id}/stores", response_model=list[PlatformStoreOut])
def list_platform_stores(
    business_id: str,
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if not db.get(Business, business_id):
        raise HTTPException(status_code=404, detail="Business not found.")
    return db.query(Store).filter(Store.business_id == business_id).order_by(Store.created_at).all()


@router.post("/admin/businesses/{business_id}/stores", response_model=PlatformStoreOut, status_code=201)
def create_platform_store(
    business_id: str,
    payload: StoreCreate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    code = payload.code.upper()
    if db.query(Store).filter(Store.business_id == business_id, Store.code == code).first():
        raise HTTPException(status_code=409, detail="Store code already exists in this business.")
    store = Store(business_id=business_id, name=payload.name.strip(), code=code, address=payload.address)
    db.add(store)
    db.flush()
    _audit(db, admin, "platform_store_created", business_id=business_id, details={"store_id": store.id})
    db.commit()
    db.refresh(store)
    return store


@router.patch("/admin/stores/{store_id}/status", response_model=PlatformStoreOut)
def update_platform_store_status(
    store_id: str,
    payload: StoreStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    store = db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    store.is_active = payload.is_active
    _audit(
        db,
        admin,
        "platform_store_status_changed",
        business_id=store.business_id,
        details={"store_id": store.id, "is_active": payload.is_active, "reason": payload.reason},
    )
    db.commit()
    db.refresh(store)
    return store


@router.post("/admin/businesses/{business_id}/grant", response_model=BusinessSubscriptionOut, status_code=201)
def grant_subscription(
    business_id: str,
    payload: AdminSubscriptionGrant,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    plan = db.get(SubscriptionPlan, payload.plan_id)
    if not business or not plan:
        raise HTTPException(status_code=404, detail="Business or plan not found.")
    if not plan.is_active:
        raise HTTPException(status_code=409, detail="Inactive plans cannot be granted.")
    if plan.entitlement_schema_version < 1:
        raise HTTPException(status_code=409, detail="Review and save this plan's entitlements before granting it.")
    if plan.currency != business.currency:
        raise HTTPException(status_code=422, detail="Plan currency must match the business currency.")
    now = datetime.now(timezone.utc)
    active_subscriptions = (
        db.query(BusinessSubscription)
        .filter(
            BusinessSubscription.business_id == business_id,
            BusinessSubscription.status.in_(["active", "trial", "pending"]),
        )
        .all()
    )
    for previous in active_subscriptions:
        previous.status = "superseded"
    duration = payload.duration_days or (plan.trial_days if payload.grant_type == "trial" else plan.duration_days)
    if payload.grant_type == "trial" and duration <= 0:
        raise HTTPException(status_code=422, detail="A positive trial duration is required.")
    subscription = BusinessSubscription(
        business_id=business_id,
        plan_id=plan.id,
        status="trial" if payload.grant_type == "trial" else "active",
        started_at=now,
        expires_at=now + timedelta(days=duration),
        renewal_price=plan.price,
        currency=plan.currency,
        entitlement_mode="enforced",
    )
    db.add(subscription)
    db.flush()
    _audit(
        db,
        admin,
        "subscription_administratively_granted",
        business_id=business_id,
        details={
            "subscription_id": subscription.id,
            "plan_id": plan.id,
            "duration_days": duration,
            "grant_type": payload.grant_type,
            "reason": payload.reason,
        },
    )
    db.commit()
    db.refresh(subscription)
    return subscription


@router.get("/admin/subscriptions", response_model=list[PlatformSubscriptionOut])
def list_platform_subscriptions(
    status: Literal["pending", "trial", "active", "suspended", "cancelled", "superseded"] | None = None,
    business_id: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(BusinessSubscription, Business.name).join(Business, Business.id == BusinessSubscription.business_id)
    if status:
        query = query.filter(BusinessSubscription.status == status)
    if business_id:
        query = query.filter(BusinessSubscription.business_id == business_id)
    rows = query.order_by(BusinessSubscription.created_at.desc()).offset(offset).limit(limit).all()
    return [
        PlatformSubscriptionOut(**{
            **{column.name: getattr(subscription, column.name) for column in BusinessSubscription.__table__.columns},
            "business_name": business_name,
            "effective_status": "expired" if subscription.status in {"active", "trial"} and not _subscription_is_current(subscription) else subscription.status,
        })
        for subscription, business_name in rows
    ]


@router.patch("/admin/subscriptions/{subscription_id}", response_model=PlatformSubscriptionOut)
def update_platform_subscription(
    subscription_id: str,
    payload: PlatformSubscriptionUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    subscription = db.get(BusinessSubscription, subscription_id)
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    previous_status = subscription.status
    if payload.status == "active" and previous_status == "pending" and subscription.renewal_price > 0:
        confirmed_payment = db.query(SubscriptionPayment.id).filter(
            SubscriptionPayment.subscription_id == subscription.id,
            SubscriptionPayment.status == "confirmed",
        ).first()
        if not confirmed_payment:
            raise HTTPException(status_code=409, detail="Confirm a subscription payment or grant an audited complimentary subscription before activation.")
    if payload.extend_days:
        now = datetime.now(timezone.utc)
        current_expiry = subscription.expires_at
        if current_expiry and current_expiry.tzinfo is None:
            current_expiry = current_expiry.replace(tzinfo=timezone.utc)
        base = current_expiry if current_expiry and current_expiry > now else now
        subscription.expires_at = base + timedelta(days=payload.extend_days)
    if payload.status:
        subscription.status = payload.status
    if payload.entitlement_mode:
        if payload.entitlement_mode == "enforced":
            plan = db.get(SubscriptionPlan, subscription.plan_id) if subscription.plan_id else None
            if not plan or plan.entitlement_schema_version < 1:
                raise HTTPException(status_code=409, detail="Review and save the subscription plan entitlements before enforcing them.")
        subscription.entitlement_mode = payload.entitlement_mode
    _audit(db, admin, "subscription_administratively_updated", business_id=subscription.business_id, details={
        "subscription_id": subscription.id,
        "previous_status": previous_status,
        "status": subscription.status,
        "extend_days": payload.extend_days,
        "entitlement_mode": subscription.entitlement_mode,
        "reason": payload.reason,
    })
    db.commit()
    db.refresh(subscription)
    business = db.get(Business, subscription.business_id)
    return PlatformSubscriptionOut(**{
        **{column.name: getattr(subscription, column.name) for column in BusinessSubscription.__table__.columns},
        "business_name": business.name if business else "",
        "effective_status": "expired" if subscription.status in {"active", "trial"} and not _subscription_is_current(subscription) else subscription.status,
    })


@router.get("/admin/payments", response_model=list[SubscriptionPaymentOut])
def list_subscription_payments(
    status: Literal["pending", "confirmed", "failed", "refunded"] | None = None,
    business_id: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(SubscriptionPayment)
    if status:
        query = query.filter(SubscriptionPayment.status == status)
    if business_id:
        query = query.filter(SubscriptionPayment.business_id == business_id)
    payments = query.order_by(SubscriptionPayment.paid_at.desc(), SubscriptionPayment.created_at.desc()).offset(offset).limit(limit).all()
    return [_platform_payment_out(db, payment) for payment in payments]


@router.post("/admin/payments", response_model=SubscriptionPaymentOut, status_code=201)
def record_subscription_payment(
    payload: SubscriptionPaymentCreate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    subscription = db.get(BusinessSubscription, payload.subscription_id)
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found.")
    if payload.transaction_reference:
        payload.transaction_reference = payload.transaction_reference.strip() or None
    if payload.transaction_reference and db.query(SubscriptionPayment.id).filter(
        SubscriptionPayment.transaction_reference == payload.transaction_reference,
    ).first():
        raise HTTPException(status_code=409, detail="That payment reference is already recorded.")
    paid_at = payload.paid_at
    if paid_at.tzinfo is None:
        paid_at = paid_at.replace(tzinfo=timezone.utc)
    payment = SubscriptionPayment(
        business_id=subscription.business_id,
        subscription_id=subscription.id,
        plan_id=subscription.plan_id,
        amount=payload.amount,
        currency=subscription.currency,
        payment_method=payload.payment_method.strip(),
        transaction_reference=payload.transaction_reference,
        paid_at=paid_at,
        status="pending",
        confirmation_details=payload.confirmation_details.strip() if payload.confirmation_details else None,
    )
    db.add(payment)
    try:
        db.flush()
        _audit(db, admin, "subscription_payment_recorded", business_id=subscription.business_id, details={
            "payment_id": payment.id,
            "subscription_id": subscription.id,
            "amount": str(payment.amount),
            "currency": payment.currency,
            "payment_method": payment.payment_method,
            "transaction_reference": payment.transaction_reference,
            "status": payment.status,
        })
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="That payment reference is already recorded.") from error
    db.refresh(payment)
    return _platform_payment_out(db, payment)


@router.patch("/admin/payments/{payment_id}", response_model=SubscriptionPaymentOut)
def update_subscription_payment(
    payment_id: str,
    payload: SubscriptionPaymentStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    payment = db.query(SubscriptionPayment).filter(
        SubscriptionPayment.id == payment_id,
    ).with_for_update().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found.")
    if payload.status == "refunded":
        raise HTTPException(status_code=422, detail="Use the refund action to record a confirmed payment refund.")
    if payment.status == payload.status:
        return _platform_payment_out(db, payment)
    if payment.status != "pending":
        _audit(db, admin, "subscription_payment_change_rejected", business_id=payment.business_id, details={
            "payment_id": payment.id,
            "requested_status": payload.status,
            "current_status": payment.status,
            "reason": payload.details.strip(),
        })
        db.commit()
        raise HTTPException(status_code=409, detail="Only pending payments can be confirmed or marked failed.")
    if payload.status == "failed":
        payment.status = "failed"
        payment.confirmation_details = payload.details.strip()
    else:
        subscription = db.get(BusinessSubscription, payment.subscription_id)
        if not subscription or subscription.status not in {"pending", "active", "trial"}:
            _audit(db, admin, "subscription_payment_confirmation_rejected", business_id=payment.business_id, details={
                "payment_id": payment.id,
                "subscription_id": payment.subscription_id,
                "reason": "Subscription no longer exists or is not eligible for payment activation.",
                "admin_reason": payload.details.strip(),
            })
            db.commit()
            raise HTTPException(status_code=409, detail="Payment subscription no longer exists.")
        if payment.amount != subscription.renewal_price or payment.currency != subscription.currency:
            _audit(db, admin, "subscription_payment_confirmation_rejected", business_id=payment.business_id, details={
                "payment_id": payment.id,
                "subscription_id": subscription.id,
                "payment_amount": str(payment.amount),
                "expected_amount": str(subscription.renewal_price),
                "payment_currency": payment.currency,
                "expected_currency": subscription.currency,
                "reason": "Submitted payment amount or currency did not match the subscription.",
                "admin_reason": payload.details.strip(),
            })
            db.commit()
            raise HTTPException(status_code=409, detail="Payment amount or currency does not match the subscription. Review the records before confirmation.")
        payment.status = "confirmed"
        payment.confirmation_user_id = admin.id
        payment.confirmed_at = datetime.now(timezone.utc)
        payment.confirmation_details = payload.details.strip()
        now = datetime.now(timezone.utc)
        expiry = subscription.expires_at
        if expiry and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        base = expiry if expiry and expiry > now else now
        plan = db.get(SubscriptionPlan, subscription.plan_id) if subscription.plan_id else None
        duration = plan.duration_days if plan else 30
        if subscription.status == "pending":
            subscription.started_at = now
            base = now
        subscription.status = "active"
        subscription.expires_at = base + timedelta(days=duration)
        subscription.last_billed_at = payment.paid_at
    _audit(db, admin, f"subscription_payment_{payment.status}", business_id=payment.business_id, details={
        "payment_id": payment.id,
        "subscription_id": payment.subscription_id,
        "amount": str(payment.amount),
        "currency": payment.currency,
        "reason": payload.details.strip(),
    })
    db.commit()
    db.refresh(payment)
    return _platform_payment_out(db, payment)


@router.post("/admin/payments/{payment_id}/refund", response_model=SubscriptionPaymentOut)
def refund_subscription_payment(
    payment_id: str,
    payload: SubscriptionPaymentStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    payment = db.get(SubscriptionPayment, payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found.")
    if payment.status == "refunded":
        return _platform_payment_out(db, payment)
    if payment.status != "confirmed":
        raise HTTPException(status_code=409, detail="Only confirmed payments may be refunded.")
    if not payload.refund_amount or payload.refund_amount != payment.amount:
        raise HTTPException(status_code=422, detail="A full refund amount equal to the confirmed payment is required.")
    payment.status = "refunded"
    payment.refund_amount = payload.refund_amount
    payment.refunded_at = datetime.now(timezone.utc)
    payment.refund_details = payload.details.strip()
    _audit(db, admin, "subscription_payment_refunded", business_id=payment.business_id, details={
        "payment_id": payment.id,
        "amount": str(payment.refund_amount),
        "currency": payment.currency,
        "reason": payment.refund_details,
    })
    db.commit()
    db.refresh(payment)
    return _platform_payment_out(db, payment)


@router.get("/admin/revenue", response_model=PlatformRevenueOut)
def platform_revenue(
    start_date: date = Query(default_factory=lambda: date.today() - timedelta(days=364)),
    end_date: date = Query(default_factory=date.today),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")
    payments = db.query(SubscriptionPayment).filter(
        func.date(SubscriptionPayment.paid_at) >= start_date.isoformat(),
        func.date(SubscriptionPayment.paid_at) <= end_date.isoformat(),
        SubscriptionPayment.status.in_(["confirmed", "refunded", "failed", "pending"]),
    ).all()
    confirmed = [payment for payment in payments if payment.status in {"confirmed", "refunded"}]
    daily: dict[tuple[str, str], dict[str, Decimal]] = {}
    monthly: dict[tuple[str, str], dict[str, Decimal]] = {}
    yearly: dict[tuple[str, str], dict[str, Decimal]] = {}
    by_plan: dict[tuple[str | None, str, str], Decimal] = {}
    refunds: dict[str, Decimal] = {}
    for payment in confirmed:
        paid_at = payment.paid_at.date() if payment.paid_at.tzinfo else payment.paid_at.date()
        if paid_at < start_date or paid_at > end_date:
            continue
        for bucket, key in ((daily, paid_at.isoformat()), (monthly, paid_at.strftime("%Y-%m")), (yearly, paid_at.strftime("%Y"))):
            currency_bucket = bucket.setdefault((key, payment.currency), {"confirmed": Decimal("0"), "refunded": Decimal("0")})
            currency_bucket["confirmed"] += Decimal(str(payment.amount))
            if payment.status == "refunded":
                refund = Decimal(str(payment.refund_amount or 0))
                currency_bucket["refunded"] += refund
                refunds[payment.currency] = refunds.get(payment.currency, Decimal("0")) + refund
        if payment.status == "confirmed":
            plan = db.get(SubscriptionPlan, payment.plan_id) if payment.plan_id else None
            key = (payment.plan_id, plan.name if plan else "Archived plan", payment.currency)
            by_plan[key] = by_plan.get(key, Decimal("0")) + Decimal(str(payment.amount))

    def periods(data: dict[tuple[str, str], dict[str, Decimal]]) -> list[RevenuePeriodOut]:
        return [RevenuePeriodOut(period=period, currency=currency, confirmed_amount=value["confirmed"], refunded_amount=value["refunded"])
                for (period, currency), value in sorted(data.items())]

    pending_amount: dict[str, Decimal] = {}
    for payment in payments:
        if payment.status == "pending":
            pending_amount[payment.currency] = pending_amount.get(payment.currency, Decimal("0")) + Decimal(str(payment.amount))
    pending_by_currency = [PlatformCurrencyTotals(
        currency=currency, sales_revenue=amount, expenses=Decimal("0"), gross_profit=None,
        outstanding_debt=Decimal("0"), supplier_liabilities=Decimal("0"), transaction_count=0,
    ) for currency, amount in sorted(pending_amount.items())]
    refund_totals = [PlatformCurrencyTotals(
        currency=currency, sales_revenue=Decimal("0"), expenses=amount, gross_profit=None,
        outstanding_debt=Decimal("0"), supplier_liabilities=Decimal("0"), transaction_count=0,
    ) for currency, amount in sorted(refunds.items())]
    paying_businesses = db.query(func.count(func.distinct(SubscriptionPayment.business_id))).filter(
        SubscriptionPayment.status == "confirmed",
        SubscriptionPayment.business_id.in_(db.query(BusinessSubscription.business_id).filter(
            BusinessSubscription.status.in_(["active", "trial"]),
            (BusinessSubscription.expires_at.is_(None)) | (BusinessSubscription.expires_at > datetime.now(timezone.utc)),
        )),
    ).scalar() or 0
    expired_count = db.query(func.count(BusinessSubscription.id)).filter(
        BusinessSubscription.status.in_(["active", "trial"]),
        BusinessSubscription.expires_at.is_not(None),
        BusinessSubscription.expires_at <= datetime.now(timezone.utc),
    ).scalar() or 0
    return PlatformRevenueOut(
        start_date=start_date,
        end_date=end_date,
        daily=periods(daily),
        monthly=periods(monthly),
        yearly=periods(yearly),
        by_plan=[RevenueByPlanOut(plan_id=plan_id, plan_name=name, currency=currency, confirmed_amount=amount)
                 for (plan_id, name, currency), amount in sorted(by_plan.items(), key=lambda row: (row[0][1], row[0][2]))],
        pending_count=sum(1 for payment in payments if payment.status == "pending"),
        pending_amount_by_currency=pending_by_currency,
        failed_count=sum(1 for payment in payments if payment.status == "failed"),
        refunds_by_currency=refund_totals,
        active_paying_business_count=paying_businesses,
        expired_subscription_count=expired_count,
    )


@router.get("/admin/audit-logs", response_model=list[SubscriptionAuditOut])
def list_platform_audit_logs(
    business_id: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=250),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(SubscriptionAuditLog)
    if business_id:
        query = query.filter(SubscriptionAuditLog.business_id == business_id)
    return query.order_by(SubscriptionAuditLog.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/admin/analytics", response_model=PlatformAnalyticsOut)
def platform_analytics(
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    del admin
    businesses = db.query(Business).all()
    business_count = len(businesses)
    active_business_count = sum(1 for business in businesses if business.is_active)
    active_subscriptions = sum(
        1 for subscription in db.query(BusinessSubscription).all()
        if _subscription_is_current(subscription)
    )
    pending_subscriptions = (
        db.query(func.count(BusinessSubscription.id))
        .filter(BusinessSubscription.status == "pending")
        .scalar()
        or 0
    )
    currency_totals, transaction_count = _platform_currency_totals(db, businesses)
    growth: dict[str, int] = {}
    for business in businesses:
        month = business.created_at.strftime("%Y-%m")
        growth[month] = growth.get(month, 0) + 1
    return PlatformAnalyticsOut(
        business_count=business_count,
        active_business_count=active_business_count,
        user_count=db.query(func.count(User.id)).scalar() or 0,
        store_count=db.query(func.count(Store.id)).scalar() or 0,
        employee_count=db.query(func.count(Membership.id)).filter(
            Membership.is_active.is_(True), Membership.role != "owner",
        ).scalar() or 0,
        product_count=db.query(func.count(Product.id)).scalar() or 0,
        transaction_count=transaction_count,
        active_subscription_count=active_subscriptions,
        pending_subscription_count=pending_subscriptions,
        confirmed_subscription_revenue=None,
        currency=None,
        currency_totals=currency_totals,
        business_growth=[BusinessGrowthPoint(month=month, businesses=count) for month, count in sorted(growth.items())],
    )


@router.get("/admin/global-reports", response_model=GlobalReportOut)
def platform_global_reports(
    start_date: date | None = None,
    end_date: date | None = None,
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")
    businesses = db.query(Business).all()
    currency_totals, transaction_count = _platform_currency_totals(db, businesses, start_date, end_date)
    return GlobalReportOut(
        start_date=start_date,
        end_date=end_date,
        business_count=len(businesses),
        active_business_count=sum(1 for business in businesses if business.is_active),
        suspended_business_count=sum(1 for business in businesses if not business.is_active),
        user_count=db.query(func.count(User.id)).scalar() or 0,
        store_count=db.query(func.count(Store.id)).scalar() or 0,
        product_count=db.query(func.count(Product.id)).scalar() or 0,
        transaction_count=transaction_count,
        currency_totals=currency_totals,
    )


@router.get("/admin/health")
def platform_health(_admin: User = Depends(_require_super_admin), db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "service": settings.APP_NAME, "database": "connected"}
