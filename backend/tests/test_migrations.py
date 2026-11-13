from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.database import Base
from app.modules.audit import models as audit_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.businesses import models as business_models  # noqa: F401
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.customers import models as customers_models  # noqa: F401
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.inventory import models as inventory_models  # noqa: F401
from app.modules.orders import models as orders_models  # noqa: F401
from app.modules.sales import models as sales_models  # noqa: F401
from app.modules.subscriptions import models as subscriptions_models  # noqa: F401
from app.modules.sync import models as sync_models  # noqa: F401

ALEMBIC_CONFIG = Path(__file__).resolve().parents[1] / "alembic.ini"


def run_migration(connection) -> None:
    config = Config(str(ALEMBIC_CONFIG))
    config.attributes["connection"] = connection
    command.upgrade(config, "head")


def test_initial_migration_creates_schema_on_empty_database():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            run_migration(connection)
            tables = set(inspect(connection).get_table_names())
            assert "users" in tables
            assert "sales" in tables
            assert "alembic_version" in tables
            assert len(tables - {"alembic_version"}) == len(Base.metadata.tables)
    finally:
        engine.dispose()


def test_initial_migration_preserves_existing_business_data():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, full_name, email, password_hash, preferred_language, is_active, "
                    "is_email_verified, is_super_admin, created_at) "
                    "VALUES ('existing-user', 'Existing Owner', 'existing@example.com', "
                    "'hash', 'en', TRUE, FALSE, FALSE, CURRENT_TIMESTAMP)"
                )
            )
            run_migration(connection)
            assert (
                connection.execute(
                    text("SELECT full_name FROM users WHERE id = 'existing-user'")
                ).scalar_one()
                == "Existing Owner"
            )
            assert connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
    finally:
        engine.dispose()


def test_initial_migration_adds_legacy_columns_without_replacing_rows():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE sale_refunds (id VARCHAR(36) PRIMARY KEY, sale_id VARCHAR(36) NOT NULL, "
                    "amount NUMERIC(18, 2) NOT NULL, reason VARCHAR(220) NOT NULL, note VARCHAR(220), "
                    "created_by VARCHAR(36) NOT NULL, created_at DATETIME NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO sale_refunds "
                    "(id, sale_id, amount, reason, created_by, created_at) "
                    "VALUES ('refund-1', 'sale-1', 10, 'legacy', 'user-1', CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE sale_items (id VARCHAR(36) PRIMARY KEY, sale_id VARCHAR(36) NOT NULL, "
                    "variant_id VARCHAR(36) NOT NULL, product_name VARCHAR(180) NOT NULL, "
                    "variant_name VARCHAR(180) NOT NULL, sku VARCHAR(80) NOT NULL, "
                    "quantity NUMERIC(18, 3) NOT NULL, unit_price NUMERIC(18, 2) NOT NULL, "
                    "line_total NUMERIC(18, 2) NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE suppliers (id VARCHAR(36) PRIMARY KEY, business_id VARCHAR(36) NOT NULL, "
                    "name VARCHAR(180) NOT NULL, phone VARCHAR(32), email VARCHAR(255), "
                    "address VARCHAR(255), notes TEXT, created_at DATETIME NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO suppliers (id, business_id, name, created_at) "
                    "VALUES ('supplier-1', 'business-1', 'Legacy Supplier', CURRENT_TIMESTAMP)"
                )
            )

            run_migration(connection)

            assert (
                connection.execute(
                    text("SELECT reason FROM sale_refunds WHERE id = 'refund-1'")
                ).scalar_one()
                == "legacy"
            )
            assert connection.execute(
                text("SELECT name, is_active FROM suppliers WHERE id = 'supplier-1'")
            ).one() == ("Legacy Supplier", 1)
            assert {"idempotency_key", "request_hash", "items_json"} <= {
                column["name"]
                for column in inspect(connection).get_columns("sale_refunds")
            }
            assert "unit_cost" in {
                column["name"]
                for column in inspect(connection).get_columns("sale_items")
            }
    finally:
        engine.dispose()
