from fastapi import APIRouter
from app.modules.auth.router import router as auth_router
from app.modules.assistant.router import router as assistant_router
from app.modules.businesses.router import router as businesses_router
from app.modules.catalog.router import router as catalog_router
from app.modules.customers.router import router as customers_router
from app.modules.employees.router import router as employees_router
from app.modules.finance.router import router as finance_router
from app.modules.inventory.router import router as inventory_router
from app.modules.orders.router import router as orders_router
from app.modules.reports.router import router as reports_router
from app.modules.sales.router import router as sales_router
from app.modules.sync.router import router as sync_router
from app.modules.subscriptions.router import router as subscriptions_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["authentication"])
api_router.include_router(assistant_router, prefix="/assistant", tags=["business assistant"])
api_router.include_router(businesses_router, prefix="/businesses", tags=["businesses and stores"])
api_router.include_router(catalog_router, prefix="/catalog", tags=["catalog"])
api_router.include_router(customers_router, prefix="/customers", tags=["customers and debtors"])
api_router.include_router(employees_router, prefix="/employees", tags=["employees and multi-store access"])
api_router.include_router(finance_router, prefix="/finance", tags=["finance and cashbook"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["inventory and purchasing"])
api_router.include_router(orders_router, prefix="/orders", tags=["orders and invoices"])
api_router.include_router(reports_router, prefix="/reports", tags=["reports and analytics"])
api_router.include_router(sales_router, prefix="/sales", tags=["sales and pos"])
api_router.include_router(sync_router, prefix="/sync", tags=["offline synchronization"])
api_router.include_router(subscriptions_router, prefix="/subscriptions", tags=["subscriptions and platform administration"])
