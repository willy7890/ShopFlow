from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

class Base(DeclarativeBase):
    pass

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.modules.auth import models as auth_models  # noqa: F401
    from app.modules.audit import models as audit_models  # noqa: F401
    from app.modules.businesses import models as business_models  # noqa: F401
    from app.modules.catalog import models as catalog_models  # noqa: F401
    from app.modules.customers import models as customers_models  # noqa: F401
    from app.modules.finance import models as finance_models  # noqa: F401
    from app.modules.inventory import models as inventory_models  # noqa: F401
    from app.modules.orders import models as orders_models  # noqa: F401
    from app.modules.sales import models as sales_models  # noqa: F401
    from app.modules.sync import models as sync_models  # noqa: F401
    from app.modules.subscriptions import models as subscriptions_models  # noqa: F401

    if "sale_refunds" in inspect(engine).get_table_names():
        refund_columns = {column["name"] for column in inspect(engine).get_columns("sale_refunds")}
        refund_migrations = {
            "idempotency_key": "ALTER TABLE sale_refunds ADD COLUMN idempotency_key VARCHAR(128)",
            "request_hash": "ALTER TABLE sale_refunds ADD COLUMN request_hash VARCHAR(64)",
            "items_json": "ALTER TABLE sale_refunds ADD COLUMN items_json TEXT",
        }
        with engine.begin() as connection:
            for column, migration in refund_migrations.items():
                if column not in refund_columns:
                    connection.execute(text(migration))
    Base.metadata.create_all(bind=engine)
    sale_item_columns = {column["name"] for column in inspect(engine).get_columns("sale_items")}
    if "unit_cost" not in sale_item_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE sale_items ADD COLUMN unit_cost NUMERIC(18, 2)"))
    supplier_columns = {column["name"] for column in inspect(engine).get_columns("suppliers")}
    if "is_active" not in supplier_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE"))
