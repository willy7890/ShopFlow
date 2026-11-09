from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Membership, Store
from app.modules.employees.schemas import ALLOWED_EMPLOYEE_PERMISSIONS, ALLOWED_EMPLOYEE_ROLES, EmployeeInvite, EmployeeOut, EmployeeUpdate

router = APIRouter()

DEFAULT_ROLE_PERMISSIONS = {
    "owner": sorted(ALLOWED_EMPLOYEE_PERMISSIONS),
    "manager": ["manage_business", "manage_stores", "manage_employees", "manage_products", "manage_inventory", "manage_sales", "manage_orders", "manage_finance", "manage_customers", "manage_suppliers", "view_reports", "view_dashboard"],
    "store_manager": ["manage_products", "manage_inventory", "manage_sales", "manage_orders", "view_reports", "view_dashboard"],
    "cashier": ["manage_sales", "view_dashboard"],
    "accountant": ["manage_finance", "manage_customers", "manage_suppliers", "view_reports", "view_dashboard"],
    "inventory_manager": ["manage_inventory", "manage_products", "view_reports", "view_dashboard"],
}


def _validate_store_ids(db: Session, business_id: str, store_ids: list[str]) -> list[str]:
    if not store_ids:
        return []
    unique_store_ids = []
    seen = set()
    for store_id in store_ids:
        if store_id in seen:
            continue
        seen.add(store_id)
        unique_store_ids.append(store_id)
    available = (
        db.query(Store.id)
        .filter(Store.business_id == business_id, Store.is_active.is_(True), Store.id.in_(unique_store_ids))
        .all()
    )
    available_ids = {store_id for (store_id,) in available}
    missing = [store_id for store_id in unique_store_ids if store_id not in available_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Store(s) not found in this business: {', '.join(missing)}")
    return unique_store_ids


def _normalize_permissions(values: list[str] | None) -> list[str]:
    if not values:
        return []
    normalized = []
    seen = set()
    for value in values:
        permission = str(value).strip()
        if not permission or permission not in ALLOWED_EMPLOYEE_PERMISSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported permission: {value}")
        if permission not in seen:
            seen.add(permission)
            normalized.append(permission)
    return sorted(normalized)


@router.get("", response_model=list[EmployeeOut])
def list_employees(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    if membership.role not in {"owner", "manager", "store_manager"}:
        raise HTTPException(status_code=403, detail="You do not have permission to manage employees")
    query = (
        db.query(Membership)
        .filter(Membership.business_id == membership.business_id, Membership.is_active.is_(True))
        .order_by(Membership.created_at.asc())
    )
    employees = []
    for employee_membership in query.all():
        user = db.get(User, employee_membership.user_id)
        if not user:
            continue
        employees.append(
            EmployeeOut(
                id=employee_membership.id,
                user_id=user.id,
                full_name=user.full_name,
                email=user.email,
                phone=user.phone,
                role=employee_membership.role,
                store_access=list(employee_membership.store_access or []),
                permissions=list(employee_membership.permissions or []),
                is_active=employee_membership.is_active,
            )
        )
    return employees


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    employee_membership = (
        db.query(Membership)
        .filter(Membership.id == employee_id, Membership.business_id == membership.business_id)
        .first()
    )
    if not employee_membership:
        raise HTTPException(status_code=404, detail="Employee not found")
    if membership.role not in {"owner", "manager", "store_manager"} and employee_membership.user_id != membership.user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to view this employee")
    user = db.get(User, employee_membership.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Employee user account not found")
    return EmployeeOut(
        id=employee_membership.id,
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        role=employee_membership.role,
        store_access=list(employee_membership.store_access or []),
        permissions=list(employee_membership.permissions or []),
        is_active=employee_membership.is_active,
    )


@router.post("/invite", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def invite_employee(
    payload: EmployeeInvite,
    membership: Membership = Depends(require_roles("owner", "manager")),
    db: Session = Depends(get_db),
):
    if payload.role not in ALLOWED_EMPLOYEE_ROLES:
        raise HTTPException(status_code=400, detail="Unsupported employee role")
    store_ids = _validate_store_ids(db, membership.business_id, payload.store_ids)
    if not payload.store_ids:
        if membership.role == "owner":
            store_ids = [
                store.id
                for store in db.query(Store)
                .filter(Store.business_id == membership.business_id, Store.is_active.is_(True))
                .order_by(Store.created_at.asc())
                .all()
            ]
        else:
            store_ids = list(membership.store_access or [])
    permissions = _normalize_permissions(payload.permissions or DEFAULT_ROLE_PERMISSIONS.get(payload.role, []))
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User must register before being assigned to this business")
    existing_membership = (
        db.query(Membership)
        .filter(Membership.business_id == membership.business_id, Membership.user_id == user.id)
        .first()
    )
    if existing_membership:
        if not existing_membership.is_active:
            existing_membership.is_active = True
        existing_membership.role = payload.role
        existing_membership.store_access = store_ids
        existing_membership.permissions = permissions
        db.commit()
        db.refresh(existing_membership)
        employee = existing_membership
    else:
        employee = Membership(
            business_id=membership.business_id,
            user_id=user.id,
            role=payload.role,
            store_access=store_ids,
            permissions=permissions,
            is_active=payload.is_active,
        )
        db.add(employee)
        db.commit()
        db.refresh(employee)

    return EmployeeOut(
        id=employee.id,
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        role=employee.role,
        store_access=list(employee.store_access or []),
        permissions=list(employee.permissions or []),
        is_active=employee.is_active,
    )


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: str,
    payload: EmployeeUpdate,
    membership: Membership = Depends(require_roles("owner", "manager")),
    db: Session = Depends(get_db),
):
    employee_membership = (
        db.query(Membership)
        .filter(Membership.id == employee_id, Membership.business_id == membership.business_id)
        .first()
    )
    if not employee_membership:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee_membership.user_id == membership.user_id and membership.role != "owner":
        raise HTTPException(status_code=403, detail="You cannot change your own role while using a manager role")
    if payload.role is not None:
        if payload.role not in ALLOWED_EMPLOYEE_ROLES:
            raise HTTPException(status_code=400, detail="Unsupported employee role")
        employee_membership.role = payload.role
        if payload.permissions is None:
            employee_membership.permissions = _normalize_permissions(DEFAULT_ROLE_PERMISSIONS.get(payload.role, []))
    if payload.store_ids is not None:
        employee_membership.store_access = _validate_store_ids(db, membership.business_id, payload.store_ids)
    if payload.permissions is not None:
        employee_membership.permissions = _normalize_permissions(payload.permissions)
    if payload.is_active is not None:
        if employee_membership.role == "owner" and payload.is_active is False:
            raise HTTPException(status_code=400, detail="The business owner cannot be deactivated")
        employee_membership.is_active = payload.is_active
    db.commit()
    db.refresh(employee_membership)
    user = db.get(User, employee_membership.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Employee user account not found")
    return EmployeeOut(
        id=employee_membership.id,
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        role=employee_membership.role,
        store_access=list(employee_membership.store_access or []),
        permissions=list(employee_membership.permissions or []),
        is_active=employee_membership.is_active,
    )
