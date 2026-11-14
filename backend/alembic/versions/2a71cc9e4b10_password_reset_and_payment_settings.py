"""Add hashed password reset tokens and managed subscription payment details.

Revision ID: 2a71cc9e4b10
Revises: f1c24b9d6a30
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import sqlalchemy as sa
from alembic import op


revision = "2a71cc9e4b10"
down_revision = "f1c24b9d6a30"
branch_labels = None
depends_on = None


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return set(bind.execute(sa.text(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = :table_name"
        ), {"table_name": table_name}).scalars())
    if bind.dialect.name == "postgresql":
        return set(bind.execute(sa.text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = :table_name"
        ), {"table_name": table_name}).scalars())
    return {item["name"] for item in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "users" in tables:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "password_changed_at" not in user_columns:
            op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
        duplicate_normalized_emails = op.get_bind().execute(sa.text(
            "SELECT lower(trim(email)) FROM users GROUP BY lower(trim(email)) HAVING COUNT(*) > 1 LIMIT 1"
        )).first()
        if duplicate_normalized_emails:
            raise RuntimeError(
                "Duplicate normalized user emails exist. Resolve them before adding the normalized-email constraint."
            )
        user_indexes = _index_names("users")
        if "uq_users_normalized_email" not in user_indexes:
            op.create_index(
                "uq_users_normalized_email",
                "users",
                [sa.text("lower(trim(email))")],
                unique=True,
            )
    if "password_reset_tokens" not in tables:
        op.create_table(
            "password_reset_tokens",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )
    if "subscription_payment_method_settings" not in tables:
        op.create_table(
            "subscription_payment_method_settings",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("method", sa.String(length=40), nullable=False),
            sa.Column("display_name", sa.String(length=80), nullable=False),
            sa.Column("recipient_name", sa.String(length=160), nullable=False),
            sa.Column("recipient_details", sa.String(length=240), nullable=False),
            sa.Column("reference_instructions", sa.String(length=500), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("evidence_supported", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("updated_by_user_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("currency", "method", name="uq_subscription_payment_method_currency"),
        )
    if "subscription_payments" in tables:
        duplicate_payment_references = op.get_bind().execute(sa.text(
            "SELECT lower(trim(transaction_reference)) FROM subscription_payments "
            "WHERE transaction_reference IS NOT NULL AND trim(transaction_reference) <> '' "
            "GROUP BY lower(trim(transaction_reference)) HAVING COUNT(*) > 1 LIMIT 1"
        )).first()
        if duplicate_payment_references:
            raise RuntimeError(
                "Duplicate normalized payment references exist. Resolve them before adding the payment-reference constraint."
            )
        payment_indexes = _index_names("subscription_payments")
        if "uq_subscription_payment_normalized_reference" not in payment_indexes:
            op.create_index(
                "uq_subscription_payment_normalized_reference",
                "subscription_payments",
                [sa.text("lower(trim(transaction_reference))")],
                unique=True,
                sqlite_where=sa.text("transaction_reference IS NOT NULL"),
                postgresql_where=sa.text("transaction_reference IS NOT NULL"),
            )
    # Add only these new, uniquely identified TZS products. Historical plans,
    # attached subscriptions, and payment rows are never edited or converted.
    if "subscription_plans" in tables:
        plans = sa.table(
            "subscription_plans",
            sa.column("id", sa.String(36)), sa.column("slug", sa.String(40)),
            sa.column("name", sa.String(80)), sa.column("description", sa.String(500)),
            sa.column("price", sa.Numeric(12, 2)), sa.column("currency", sa.String(3)),
            sa.column("duration_days", sa.Integer()), sa.column("trial_days", sa.Integer()),
            sa.column("features", sa.JSON()), sa.column("entitlement_schema_version", sa.Integer()),
            sa.column("is_active", sa.Boolean()), sa.column("archived_at", sa.DateTime(timezone=True)),
            sa.column("created_at", sa.DateTime(timezone=True)), sa.column("updated_at", sa.DateTime(timezone=True)),
        )
        products = [
            ("basic-tzs-10000", "Basic", "Monthly core sales, products, inventory, and customer tools.", "10000.00", {
                "dashboard": True, "sales_pos": True, "product_management": True, "product_categories": True,
                "inventory": True, "customers": True, "max_users": 3, "max_employees": 2,
                "max_stores": 1, "max_products": 100,
            }),
            ("standard-tzs-20000", "Standard", "Monthly operations with orders, supplier tools, debts, cashbook, and reports.", "20000.00", {
                "dashboard": True, "sales_pos": True, "orders": True, "product_management": True,
                "product_categories": True, "inventory": True, "stock_alerts": True, "invoices": True,
                "customers": True, "customer_debtors": True, "supplier_management": True,
                "supplier_payments": True, "cashbook": True, "financial_reports": True, "sales_reports": True,
                "profit_reports": True, "inventory_reports": True, "employee_management": True, "csv_exports": True,
                "max_users": 10, "max_employees": 8, "max_stores": 3, "max_products": 1000,
            }),
            ("premium-tzs-35000", "Premium", "Monthly full operations with multi-store tools, analytics, and exports.", "35000.00", {
                "dashboard": True, "sales_pos": True, "orders": True, "product_management": True,
                "product_categories": True, "inventory": True, "stock_alerts": True, "invoices": True,
                "customers": True, "customer_debtors": True, "supplier_management": True,
                "supplier_payments": True, "cashbook": True, "financial_reports": True, "sales_reports": True,
                "profit_reports": True, "inventory_reports": True, "employee_management": True,
                "advanced_permissions": True, "multi_store": True, "advanced_analytics": True,
                "csv_exports": True, "pdf_exports": True, "offline_sync": True,
                "max_users": 50, "max_employees": 50, "max_stores": 10, "max_products": 10000,
            }),
        ]
        connection = op.get_bind()
        now = datetime.now(timezone.utc)
        for slug, name, description, price, features in products:
            exists = connection.execute(sa.select(plans.c.id).where(plans.c.slug == slug)).first()
            if exists:
                continue
            connection.execute(sa.insert(plans).values(
                id=str(uuid4()), slug=slug, name=name, description=description,
                price=Decimal(price), currency="TZS", duration_days=30, trial_days=0,
                features=features, entitlement_schema_version=1, is_active=True,
                archived_at=None, created_at=now, updated_at=now,
            ))
    inspector = sa.inspect(op.get_bind())
    password_indexes = {item["name"] for item in inspector.get_indexes("password_reset_tokens")}
    if "ix_password_reset_tokens_user_id" not in password_indexes:
        op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    if "ix_password_reset_user_created" not in password_indexes:
        op.create_index("ix_password_reset_user_created", "password_reset_tokens", ["user_id", "created_at"])
    setting_indexes = {item["name"] for item in inspector.get_indexes("subscription_payment_method_settings")}
    if "ix_subscription_payment_settings_active_currency" not in setting_indexes:
        op.create_index("ix_subscription_payment_settings_active_currency", "subscription_payment_method_settings", ["currency", "is_active"])


def downgrade() -> None:
    raise RuntimeError("ShopFlow database migrations are forward-only to protect customer records.")
