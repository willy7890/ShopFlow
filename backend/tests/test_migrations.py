from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

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
            assert "email_verification_tokens" in tables
            assert "subscription_payments" in tables
            assert "alembic_version" in tables
            assert len(tables - {"alembic_version"}) == len(Base.metadata.tables)
            index_names = {
                row[0] for row in connection.execute(text(
                    "SELECT name FROM sqlite_master WHERE type = 'index'"
                )).all()
            }
            assert "uq_users_normalized_email" in index_names
            assert "uq_subscription_payment_normalized_reference" in index_names
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
            assert connection.execute(text(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'uq_users_normalized_email'"
            )).scalar_one() == 1
            with pytest.raises(IntegrityError):
                connection.execute(text(
                    "INSERT INTO users (id, full_name, email, password_hash, preferred_language, is_active, "
                    "is_email_verified, is_super_admin, created_at) VALUES "
                    "('duplicate-user', 'Duplicate Owner', ' EXISTING@example.com ', 'hash', 'en', TRUE, FALSE, FALSE, CURRENT_TIMESTAMP)"
                ))
            assert connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
    finally:
        engine.dispose()


def test_plan_metadata_migration_upgrades_existing_rows_without_currency_changes():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            # Recreate the pre-rollout schema before seeding the legacy row.
            connection.execute(text("ALTER TABLE subscription_plans DROP COLUMN entitlement_schema_version"))
            connection.execute(text("ALTER TABLE business_subscriptions DROP COLUMN entitlement_mode"))
            connection.execute(
                text(
                    "INSERT INTO subscription_plans "
                    "(id, slug, name, price, currency, duration_days, trial_days, features, is_active, created_at, updated_at) "
                    "VALUES ('legacy-plan', 'legacy-plan', 'Legacy Plan', 1500.00, 'KES', 30, 0, '{}', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(text("ALTER TABLE subscription_plans DROP COLUMN description"))
            connection.execute(text("ALTER TABLE subscription_plans DROP COLUMN trial_days"))
            connection.execute(
                text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
            )
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES ('9d62b6f24ac1')")
            )

            run_migration(connection)

            columns = {column["name"] for column in inspect(connection).get_columns("subscription_plans")}
            assert {"description", "trial_days"}.issubset(columns)
            row = connection.execute(
                text("SELECT price, currency, trial_days FROM subscription_plans WHERE id = 'legacy-plan'")
            ).one()
            assert row.currency == "KES"
            assert row.price == 1500
            assert row.trial_days == 0
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "2a71cc9e4b10"
            assert "archived_at" in {column["name"] for column in inspect(connection).get_columns("subscription_plans")}
            assert "last_login_at" in {column["name"] for column in inspect(connection).get_columns("users")}
            assert "subscription_payments" in inspect(connection).get_table_names()
    finally:
        engine.dispose()


def test_entitlement_rollout_preserves_existing_subscription_and_payment_records():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE subscription_plans DROP COLUMN entitlement_schema_version"))
            connection.execute(text("ALTER TABLE business_subscriptions DROP COLUMN entitlement_mode"))
            connection.execute(text(
                "INSERT INTO businesses (id, name, business_type, country_code, currency, operating_mode, is_active, created_at) "
                "VALUES ('legacy-business', 'Legacy Business', 'retail', 'TZ', 'TZS', 'smart_inventory', TRUE, CURRENT_TIMESTAMP)"
            ))
            connection.execute(text(
                "INSERT INTO subscription_plans (id, slug, name, price, currency, duration_days, trial_days, features, is_active, created_at, updated_at) "
                "VALUES ('legacy-plan', 'legacy-plan', 'Legacy Plan', 15000, 'TZS', 30, 0, '{\"sales\": true}', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            connection.execute(text(
                "INSERT INTO business_subscriptions (id, business_id, plan_id, status, started_at, renewal_price, currency, feature_overrides, created_at, updated_at) "
                "VALUES ('legacy-subscription', 'legacy-business', 'legacy-plan', 'active', CURRENT_TIMESTAMP, 15000, 'TZS', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            connection.execute(text(
                "INSERT INTO subscription_payments (id, business_id, subscription_id, plan_id, amount, currency, payment_method, transaction_reference, paid_at, status, created_at) "
                "VALUES ('legacy-payment', 'legacy-business', 'legacy-subscription', 'legacy-plan', 15000, 'TZS', 'bank', 'LEGACY-REF-1', CURRENT_TIMESTAMP, 'confirmed', CURRENT_TIMESTAMP)"
            ))
            connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
            connection.execute(text("INSERT INTO alembic_version (version_num) VALUES ('c4a8d2e7b116')"))

            run_migration(connection)

            plan = connection.execute(text(
                "SELECT price, currency, features, entitlement_schema_version FROM subscription_plans WHERE id = 'legacy-plan'"
            )).one()
            subscription = connection.execute(text(
                "SELECT status, entitlement_mode, renewal_price, currency FROM business_subscriptions WHERE id = 'legacy-subscription'"
            )).one()
            payment = connection.execute(text(
                "SELECT amount, currency, transaction_reference, status FROM subscription_payments WHERE id = 'legacy-payment'"
            )).one()
            assert (plan.price, plan.currency, plan.features, plan.entitlement_schema_version) == (15000, "TZS", '{"sales": true}', 0)
            assert (subscription.status, subscription.entitlement_mode, subscription.renewal_price, subscription.currency) == ("active", "legacy", 15000, "TZS")
            assert (payment.amount, payment.currency, payment.transaction_reference, payment.status) == (15000, "TZS", "LEGACY-REF-1", "confirmed")
            connection.execute(text(
                "INSERT INTO business_subscriptions (id, business_id, plan_id, status, started_at, renewal_price, currency, feature_overrides, created_at, updated_at) "
                "VALUES ('new-subscription', 'legacy-business', 'legacy-plan', 'pending', CURRENT_TIMESTAMP, 15000, 'TZS', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            assert connection.execute(text(
                "SELECT entitlement_mode FROM business_subscriptions WHERE id = 'new-subscription'"
            )).scalar_one() == "enforced"
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


def test_single_super_admin_migration_does_not_change_user_roles():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, full_name, email, password_hash, preferred_language, "
                    "is_active, is_email_verified, is_super_admin, created_at) VALUES "
                    "('primary', 'Primary Owner', 'primary@example.com', 'unused-hash', 'en', TRUE, TRUE, FALSE, CURRENT_TIMESTAMP), "
                    "('legacy', 'Legacy Admin', 'legacy@example.com', 'unused-hash', 'en', TRUE, FALSE, TRUE, CURRENT_TIMESTAMP)"
                )
            )
            run_migration(connection)
            rows = connection.execute(
                text("SELECT id, is_super_admin FROM users ORDER BY id")
            ).all()
            assert rows == [("legacy", 1), ("primary", 0)]
            assert connection.execute(
                text("SELECT COUNT(*) FROM subscription_audit_logs WHERE event_type = 'super_admin_identity_reconciled'")
            ).scalar_one() == 0
    finally:
        engine.dispose()
