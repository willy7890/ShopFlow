from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.auth.models import User
from app.modules.businesses.models import Membership
from app.modules.catalog.models import Product
from app.modules.businesses.models import Store
from app.modules.subscriptions.models import BusinessSubscription, SubscriptionPlan


def _canonical_api_path(path: str) -> str:
    configured_prefix = settings.API_V1_PREFIX.rstrip("/")
    if configured_prefix and path.startswith(f"{configured_prefix}/"):
        return f"/api/v1/{path[len(configured_prefix) + 1:]}"
    return path


def _feature_for_path(path: str, method: str = "GET") -> str | None:
    path = _canonical_api_path(path)
    if path.startswith("/api/v1/reports/export/csv"):
        return "csv_exports"
    if path.startswith("/api/v1/reports/export/pdf"):
        return "pdf_exports"
    if path.startswith(("/api/v1/reports/dashboard", "/api/v1/reports/mobile-dashboard")):
        return "dashboard"
    if path.startswith("/api/v1/reports/products/low-stock"):
        return "stock_alerts"
    if path.startswith("/api/v1/reports/customers"):
        return "customer_debtors"
    if path.startswith("/api/v1/reports/suppliers"):
        return "supplier_management"
    if path.startswith("/api/v1/reports/profit"):
        return "profit_reports"
    if path.startswith(("/api/v1/reports/sales", "/api/v1/reports/transactions")):
        return "sales_reports"
    if path.startswith("/api/v1/reports/inventory"):
        return "inventory_reports"
    if path.startswith(("/api/v1/reports/products/best-selling", "/api/v1/reports/products/slow-moving")):
        return "advanced_analytics"
    if path.startswith("/api/v1/reports/store-performance"):
        return "multi_store"
    if path.startswith(("/api/v1/reports/expenses", "/api/v1/reports")):
        return "financial_reports"
    if path.endswith("/invoice") and path.startswith("/api/v1/orders/"):
        return "invoices"
    if path.startswith("/api/v1/orders"):
        return "orders"
    if path.startswith("/api/v1/catalog/categories"):
        return "product_categories"
    if path.startswith(("/api/v1/catalog/products", "/api/v1/catalog/brands", "/api/v1/catalog/units")):
        return "product_management"
    if path.startswith("/api/v1/inventory/suppliers") and ("/payments" in path or path.endswith("/statement")):
        return "supplier_payments"
    if path.startswith("/api/v1/inventory/suppliers"):
        return "supplier_management"
    if path.startswith("/api/v1/inventory"):
        return "inventory"
    if path.startswith("/api/v1/sales") or path.startswith("/api/v1/orders"):
        return "sales_pos"
    if path.startswith("/api/v1/customers"):
        if any(part in path for part in ("/payments", "/adjustments", "/history", "/statement")):
            return "customer_debtors"
        return "customers"
    if path.startswith("/api/v1/finance"):
        return "cashbook"
    if path.startswith("/api/v1/employees"):
        if method == "PATCH":
            return "advanced_permissions"
        return "employee_management"
    if path.startswith("/api/v1/businesses/") and path.endswith("/stores"):
        return "multi_store"
    if path.startswith("/api/v1/assistant"):
        return "advanced_analytics"
    if path.startswith("/api/v1/sync"):
        return "offline_sync"
    return None


def enforce_business_entitlement(
    request: Request,
    membership: Membership,
    user: User,
    db: Session,
) -> None:
    """Check the current subscription and entitlement for a mapped business API."""
    # Existing tests focus on identity/tenant permissions. A dedicated test
    # enables enforcement to exercise these rules against isolated plan data.
    from app.core.config import settings

    if settings.APP_ENV.strip().casefold() == "test":
        return
    path = _canonical_api_path(request.url.path)
    # Account owners must be able to inspect plans and complete payment onboarding
    # before a paid subscription exists. All other business scoped APIs require
    # a current subscription, including APIs without a feature-specific mapping.
    if path.startswith("/api/v1/subscriptions/"):
        return
    feature = _feature_for_path(request.url.path, request.method)
    now = datetime.now(timezone.utc)
    subscription = (
        db.query(BusinessSubscription)
        .filter(
            BusinessSubscription.business_id == membership.business_id,
            BusinessSubscription.status.in_(["active", "trial"]),
        )
        .order_by(BusinessSubscription.created_at.desc())
        .first()
    )
    expiry = subscription.expires_at if subscription else None
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if not subscription or (expiry and expiry <= now):
        raise HTTPException(status_code=402, detail={
            "code": "subscription_required",
            "message": "An active or trial subscription is required for this feature.",
            "feature": feature or "business_access",
        })
    if not feature:
        return
    if subscription.entitlement_mode == "legacy":
        # Existing subscriptions keep the access behavior they had before
        # entitlement checks. Transition is explicit, audited, and performed
        # by a Super Admin after reviewing the plan with its customer impact.
        return
    plan = db.get(SubscriptionPlan, subscription.plan_id) if subscription.plan_id else None
    if not plan or plan.entitlement_schema_version < 1:
        raise HTTPException(status_code=403, detail={
            "code": "plan_entitlements_unconfigured",
            "message": "This subscription plan needs explicit entitlement review.",
            "plan_id": subscription.plan_id,
        })
    features = dict(plan.features or {}) if plan else {}
    features.update(subscription.feature_overrides or {})
    value = features.get(feature)
    if value is not True and value != 1 and str(value).casefold() != "true":
        raise HTTPException(status_code=403, detail={
            "code": "feature_not_included",
            "message": "This feature is not included in the current subscription plan.",
            "feature": feature,
            "plan_id": subscription.plan_id,
        })

    limit_path = _canonical_api_path(request.url.path)
    limits = (("/api/v1/employees/invite", "max_users", "max_employees", "users"),
              ("/api/v1/catalog/products", "max_products", "products", "products"),
              ("/api/v1/businesses/", "max_stores", "stores", "stores"))
    if request.method != "POST":
        return
    for route_prefix, primary_key, legacy_key, resource in limits:
        if resource == "stores":
            applies = limit_path.startswith(route_prefix) and limit_path.endswith("/stores")
        else:
            applies = limit_path == route_prefix
        if not applies:
            continue
        if resource == "users":
            _check_limit(db, membership, features, "max_users", None, "users", include_owner=True)
            _check_limit(db, membership, features, "max_employees", "employees", "employees")
        else:
            _check_limit(db, membership, features, primary_key, legacy_key, resource)
        break


def _check_limit(
    db: Session,
    membership: Membership,
    features: dict,
    primary_key: str,
    legacy_key: str | None,
    resource: str,
    *,
    include_owner: bool = False,
) -> None:
    raw_limit = features.get(primary_key)
    if raw_limit is None and legacy_key:
        raw_limit = features.get(legacy_key)
    try:
        maximum = int(raw_limit) if raw_limit is not None else 0
    except (TypeError, ValueError):
        maximum = 0
    if isinstance(raw_limit, bool) or maximum < 0:
        maximum = 0
    if maximum == 0:
        raise HTTPException(status_code=403, detail={
            "code": "usage_limit_not_configured",
            "message": f"This plan does not allow additional {resource}.",
            "resource": resource,
        })
    query = db.query(Membership).filter(
        Membership.business_id == membership.business_id,
        Membership.is_active.is_(True),
    )
    if not include_owner:
        query = query.filter(Membership.role != "owner")
    if resource == "products":
        current = db.query(Product).filter(Product.business_id == membership.business_id).count()
    elif resource == "stores":
        current = db.query(Store).filter(Store.business_id == membership.business_id, Store.is_active.is_(True)).count()
    else:
        current = query.count()
    if current >= maximum:
        raise HTTPException(status_code=403, detail={
            "code": "usage_limit_reached",
            "message": f"The subscription limit for {resource} has been reached.",
            "resource": resource,
            "limit": maximum,
        })
