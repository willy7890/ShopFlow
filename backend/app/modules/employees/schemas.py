from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

ALLOWED_EMPLOYEE_ROLES = {
    "owner",
    "manager",
    "store_manager",
    "cashier",
    "accountant",
    "inventory_manager",
}

ALLOWED_EMPLOYEE_PERMISSIONS = {
    "manage_business",
    "manage_stores",
    "manage_employees",
    "manage_products",
    "manage_inventory",
    "manage_sales",
    "manage_orders",
    "manage_finance",
    "manage_customers",
    "manage_suppliers",
    "view_reports",
    "view_dashboard",
    "manage_sync",
}


class EmployeeInvite(BaseModel):
    email: EmailStr
    role: Literal["owner", "manager", "store_manager", "cashier", "accountant", "inventory_manager"] = "cashier"
    store_ids: list[str] = Field(default_factory=list)
    permissions: list[str] | None = None
    is_active: bool = True


class EmployeeUpdate(BaseModel):
    role: Literal["owner", "manager", "store_manager", "cashier", "accountant", "inventory_manager"] | None = None
    store_ids: list[str] | None = None
    permissions: list[str] | None = None
    is_active: bool | None = None


class EmployeeOut(BaseModel):
    id: str
    user_id: str
    full_name: str
    email: EmailStr
    phone: str | None
    role: str
    store_access: list[str]
    permissions: list[str]
    is_active: bool
    model_config = ConfigDict(from_attributes=True)
