"""initial shopflow schema

Revision ID: 4860a7f6ea2b
Revises:
Create Date: 2026-11-11 11:14:45.558718
"""

import sqlalchemy as sa

from alembic import op

revision = "4860a7f6ea2b"
down_revision = None
branch_labels = None
depends_on = None


def _ensure_legacy_columns() -> None:
    bind = op.get_bind()
    legacy_columns = {
        "sale_refunds": {
            "idempotency_key": "VARCHAR(128)",
            "request_hash": "VARCHAR(64)",
            "items_json": "TEXT",
        },
        "sale_items": {"unit_cost": "NUMERIC(18, 2)"},
        "suppliers": {"is_active": "BOOLEAN NOT NULL DEFAULT TRUE"},
    }
    inspector = sa.inspect(bind)
    for table_name, columns in legacy_columns.items():
        if table_name not in inspector.get_table_names():
            continue
        existing = {column["name"] for column in inspector.get_columns(table_name)}
        for column_name, definition in columns.items():
            if column_name not in existing:
                op.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
                )
                existing.add(column_name)


def upgrade() -> None:
    _ensure_legacy_columns()
    bind = op.get_bind()
    existing_tables = set(sa.inspect(bind).get_table_names())
    if "businesses" not in existing_tables:
        op.create_table(
            "businesses",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("business_type", sa.String(length=60), nullable=False),
            sa.Column("country_code", sa.String(length=2), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("operating_mode", sa.String(length=30), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("businesses")
    if "subscription_plans" not in existing_tables:
        op.create_table(
            "subscription_plans",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("slug", sa.String(length=40), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("duration_days", sa.Integer(), nullable=False),
            sa.Column("features", sa.JSON(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("slug", name="uq_subscription_plan_slug"),
        )
        existing_tables.add("subscription_plans")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("subscription_plans")
    }
    if "ix_subscription_plans_active_slug" not in existing_indexes:
        op.create_index(
            "ix_subscription_plans_active_slug",
            "subscription_plans",
            ["is_active", "slug"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("subscription_plans")
    }
    if "ix_subscription_plans_slug" not in existing_indexes:
        op.create_index(
            op.f("ix_subscription_plans_slug"),
            "subscription_plans",
            ["slug"],
            unique=False,
        )
    if "users" not in existing_tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("full_name", sa.String(length=160), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("phone", sa.String(length=32), nullable=True),
            sa.Column("password_hash", sa.String(length=255), nullable=False),
            sa.Column("preferred_language", sa.String(length=5), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("is_email_verified", sa.Boolean(), nullable=False),
            sa.Column("is_super_admin", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("phone"),
        )
        existing_tables.add("users")
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("users")}
    if "ix_users_email" not in existing_indexes:
        op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    if "brands" not in existing_tables:
        op.create_table(
            "brands",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("business_id", "name", name="uq_brand_business_name"),
        )
        existing_tables.add("brands")
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("brands")}
    if "ix_brands_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_brands_business_id"), "brands", ["business_id"], unique=False
        )
    if "business_subscriptions" not in existing_tables:
        op.create_table(
            "business_subscriptions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("plan_id", sa.String(length=36), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_billed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "renewal_price", sa.Numeric(precision=12, scale=2), nullable=False
            ),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("feature_overrides", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["plan_id"], ["subscription_plans.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("business_subscriptions")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("business_subscriptions")
    }
    if "ix_business_subscriptions_business_created" not in existing_indexes:
        op.create_index(
            "ix_business_subscriptions_business_created",
            "business_subscriptions",
            ["business_id", "created_at"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("business_subscriptions")
    }
    if "ix_business_subscriptions_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_business_subscriptions_business_id"),
            "business_subscriptions",
            ["business_id"],
            unique=False,
        )
    if "categories" not in existing_tables:
        op.create_table(
            "categories",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("parent_id", sa.String(length=36), nullable=True),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["parent_id"], ["categories.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "name", name="uq_category_business_name"
            ),
        )
        existing_tables.add("categories")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("categories")
    }
    if "ix_categories_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_categories_business_id"),
            "categories",
            ["business_id"],
            unique=False,
        )
    if "customers" not in existing_tables:
        op.create_table(
            "customers",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("phone", sa.String(length=32), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("address", sa.String(length=255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("credit_limit", sa.Numeric(precision=18, scale=2), nullable=True),
            sa.Column(
                "outstanding_balance", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "phone", name="uq_customer_business_phone"
            ),
        )
        existing_tables.add("customers")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("customers")
    }
    if "ix_customers_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_customers_business_id"), "customers", ["business_id"], unique=False
        )
    if "memberships" not in existing_tables:
        op.create_table(
            "memberships",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("role", sa.String(length=40), nullable=False),
            sa.Column("store_access", sa.JSON(), nullable=False),
            sa.Column("permissions", sa.JSON(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "user_id", name="uq_membership_business_user"
            ),
        )
        existing_tables.add("memberships")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("memberships")
    }
    if "ix_memberships_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_memberships_business_id"),
            "memberships",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("memberships")
    }
    if "ix_memberships_user_id" not in existing_indexes:
        op.create_index(
            op.f("ix_memberships_user_id"), "memberships", ["user_id"], unique=False
        )
    if "refresh_sessions" not in existing_tables:
        op.create_table(
            "refresh_sessions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("refresh_sessions")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("refresh_sessions")
    }
    if "ix_refresh_sessions_token_hash" not in existing_indexes:
        op.create_index(
            op.f("ix_refresh_sessions_token_hash"),
            "refresh_sessions",
            ["token_hash"],
            unique=True,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("refresh_sessions")
    }
    if "ix_refresh_sessions_user_id" not in existing_indexes:
        op.create_index(
            op.f("ix_refresh_sessions_user_id"),
            "refresh_sessions",
            ["user_id"],
            unique=False,
        )
    if "stores" not in existing_tables:
        op.create_table(
            "stores",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("code", sa.String(length=32), nullable=False),
            sa.Column("address", sa.String(length=255), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("business_id", "code", name="uq_store_business_code"),
        )
        existing_tables.add("stores")
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("stores")}
    if "ix_stores_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_stores_business_id"), "stores", ["business_id"], unique=False
        )
    if "subscription_audit_logs" not in existing_tables:
        op.create_table(
            "subscription_audit_logs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("event_type", sa.String(length=60), nullable=False),
            sa.Column("details", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("subscription_audit_logs")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("subscription_audit_logs")
    }
    if "ix_subscription_audit_logs_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_subscription_audit_logs_business_id"),
            "subscription_audit_logs",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("subscription_audit_logs")
    }
    if "ix_subscription_audit_logs_user_id" not in existing_indexes:
        op.create_index(
            op.f("ix_subscription_audit_logs_user_id"),
            "subscription_audit_logs",
            ["user_id"],
            unique=False,
        )
    if "suppliers" not in existing_tables:
        op.create_table(
            "suppliers",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("phone", sa.String(length=32), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("address", sa.String(length=255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("suppliers")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("suppliers")
    }
    if "ix_suppliers_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_suppliers_business_id"), "suppliers", ["business_id"], unique=False
        )
    if "sync_devices" not in existing_tables:
        op.create_table(
            "sync_devices",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("device_name", sa.String(length=120), nullable=False),
            sa.Column("device_type", sa.String(length=40), nullable=False),
            sa.Column("platform", sa.String(length=80), nullable=True),
            sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id",
                "user_id",
                "device_name",
                name="uq_sync_device_business_user_name",
            ),
        )
        existing_tables.add("sync_devices")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_devices")
    }
    if "ix_sync_devices_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_devices_business_id"),
            "sync_devices",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_devices")
    }
    if "ix_sync_devices_user_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_devices_user_id"), "sync_devices", ["user_id"], unique=False
        )
    if "units" not in existing_tables:
        op.create_table(
            "units",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=60), nullable=False),
            sa.Column("code", sa.String(length=20), nullable=False),
            sa.Column("base_unit_id", sa.String(length=36), nullable=True),
            sa.Column(
                "factor_to_base", sa.Numeric(precision=18, scale=6), nullable=False
            ),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["base_unit_id"], ["units.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("business_id", "code", name="uq_unit_business_code"),
        )
        existing_tables.add("units")
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("units")}
    if "ix_units_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_units_business_id"), "units", ["business_id"], unique=False
        )
    if "cashbook_entries" not in existing_tables:
        op.create_table(
            "cashbook_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=True),
            sa.Column("entry_type", sa.String(length=30), nullable=False),
            sa.Column("direction", sa.String(length=10), nullable=False),
            sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("category", sa.String(length=50), nullable=False),
            sa.Column("reference_type", sa.String(length=40), nullable=True),
            sa.Column("reference_id", sa.String(length=36), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("reversal_of_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["reversal_of_id"], ["cashbook_entries.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("cashbook_entries")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("cashbook_entries")
    }
    if "ix_cashbook_entries_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_cashbook_entries_business_id"),
            "cashbook_entries",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("cashbook_entries")
    }
    if "ix_cashbook_entries_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_cashbook_entries_store_id"),
            "cashbook_entries",
            ["store_id"],
            unique=False,
        )
    if "orders" not in existing_tables:
        op.create_table(
            "orders",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=False),
            sa.Column("customer_id", sa.String(length=36), nullable=True),
            sa.Column("order_number", sa.String(length=40), nullable=False),
            sa.Column("customer_name", sa.String(length=180), nullable=True),
            sa.Column("customer_phone", sa.String(length=32), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("subtotal", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("discount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column(
                "total_amount", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column("paid_amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("balance_due", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("converted_sale_id", sa.String(length=36), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["customer_id"], ["customers.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "order_number", name="uq_order_business_number"
            ),
        )
        existing_tables.add("orders")
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("orders")}
    if "ix_orders_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_orders_business_id"), "orders", ["business_id"], unique=False
        )
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("orders")}
    if "ix_orders_business_store_created" not in existing_indexes:
        op.create_index(
            "ix_orders_business_store_created",
            "orders",
            ["business_id", "store_id", "created_at"],
            unique=False,
        )
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("orders")}
    if "ix_orders_customer_id" not in existing_indexes:
        op.create_index(
            op.f("ix_orders_customer_id"), "orders", ["customer_id"], unique=False
        )
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("orders")}
    if "ix_orders_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_orders_store_id"), "orders", ["store_id"], unique=False
        )
    if "product_audit_events" not in existing_tables:
        op.create_table(
            "product_audit_events",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=True),
            sa.Column("product_id", sa.String(length=36), nullable=False),
            sa.Column("variant_id", sa.String(length=36), nullable=True),
            sa.Column("category_id", sa.String(length=36), nullable=True),
            sa.Column("category_name", sa.String(length=100), nullable=False),
            sa.Column("event_type", sa.String(length=40), nullable=False),
            sa.Column("before_json", sa.Text(), nullable=True),
            sa.Column("after_json", sa.Text(), nullable=False),
            sa.Column("actor_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("product_audit_events")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("product_audit_events")
    }
    if "ix_product_audit_events_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_product_audit_events_business_id"),
            "product_audit_events",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("product_audit_events")
    }
    if "ix_product_audit_events_product_id" not in existing_indexes:
        op.create_index(
            op.f("ix_product_audit_events_product_id"),
            "product_audit_events",
            ["product_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("product_audit_events")
    }
    if "ix_product_audit_events_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_product_audit_events_store_id"),
            "product_audit_events",
            ["store_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("product_audit_events")
    }
    if "ix_product_audit_scope_created" not in existing_indexes:
        op.create_index(
            "ix_product_audit_scope_created",
            "product_audit_events",
            ["business_id", "store_id", "category_id", "created_at"],
            unique=False,
        )
    if "products" not in existing_tables:
        op.create_table(
            "products",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("category_id", sa.String(length=36), nullable=True),
            sa.Column("brand_id", sa.String(length=36), nullable=True),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("image_url", sa.String(length=500), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["brand_id"], ["brands.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["category_id"], ["categories.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("products")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("products")
    }
    if "ix_products_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_products_business_id"), "products", ["business_id"], unique=False
        )
    if "purchases" not in existing_tables:
        op.create_table(
            "purchases",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=False),
            sa.Column("supplier_id", sa.String(length=36), nullable=True),
            sa.Column("reference_number", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column(
                "total_amount", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["created_by"],
                ["users.id"],
            ),
            sa.ForeignKeyConstraint(
                ["store_id"],
                ["stores.id"],
            ),
            sa.ForeignKeyConstraint(
                ["supplier_id"], ["suppliers.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("purchases")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("purchases")
    }
    if "ix_purchases_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_purchases_business_id"), "purchases", ["business_id"], unique=False
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("purchases")
    }
    if "ix_purchases_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_purchases_store_id"), "purchases", ["store_id"], unique=False
        )
    if "sales" not in existing_tables:
        op.create_table(
            "sales",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=False),
            sa.Column("customer_id", sa.String(length=36), nullable=True),
            sa.Column("sale_number", sa.String(length=40), nullable=False),
            sa.Column("customer_name", sa.String(length=180), nullable=True),
            sa.Column("customer_phone", sa.String(length=32), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("subtotal", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("discount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column(
                "total_amount", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column("paid_amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("balance_due", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("idempotency_key", sa.String(length=128), nullable=True),
            sa.Column("note", sa.String(length=500), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["customer_id"], ["customers.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "sale_number", name="uq_sale_business_number"
            ),
        )
        existing_tables.add("sales")
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("sales")}
    if "ix_sales_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sales_business_id"), "sales", ["business_id"], unique=False
        )
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("sales")}
    if "ix_sales_business_store_created" not in existing_indexes:
        op.create_index(
            "ix_sales_business_store_created",
            "sales",
            ["business_id", "store_id", "created_at"],
            unique=False,
        )
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("sales")}
    if "ix_sales_customer_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sales_customer_id"), "sales", ["customer_id"], unique=False
        )
    existing_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("sales")}
    if "ix_sales_store_id" not in existing_indexes:
        op.create_index(op.f("ix_sales_store_id"), "sales", ["store_id"], unique=False)
    if "sync_cursors" not in existing_tables:
        op.create_table(
            "sync_cursors",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("device_id", sa.String(length=36), nullable=False),
            sa.Column("entity_type", sa.String(length=40), nullable=False),
            sa.Column("cursor_value", sa.String(length=64), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["device_id"], ["sync_devices.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "device_id", "entity_type", name="uq_sync_cursor_device_entity"
            ),
        )
        existing_tables.add("sync_cursors")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_cursors")
    }
    if "ix_sync_cursors_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_cursors_business_id"),
            "sync_cursors",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_cursors")
    }
    if "ix_sync_cursors_device_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_cursors_device_id"),
            "sync_cursors",
            ["device_id"],
            unique=False,
        )
    if "sync_operations" not in existing_tables:
        op.create_table(
            "sync_operations",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("device_id", sa.String(length=36), nullable=False),
            sa.Column("entity_type", sa.String(length=40), nullable=False),
            sa.Column("operation_name", sa.String(length=80), nullable=False),
            sa.Column("idempotency_key", sa.String(length=128), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("result_message", sa.String(length=255), nullable=True),
            sa.Column("error_message", sa.String(length=255), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["device_id"], ["sync_devices.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "idempotency_key", name="uq_sync_operation_business_key"
            ),
        )
        existing_tables.add("sync_operations")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_operations")
    }
    if "ix_sync_operations_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_operations_business_id"),
            "sync_operations",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_operations")
    }
    if "ix_sync_operations_device_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_operations_device_id"),
            "sync_operations",
            ["device_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sync_operations")
    }
    if "ix_sync_operations_user_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sync_operations_user_id"),
            "sync_operations",
            ["user_id"],
            unique=False,
        )
    if "customer_ledger_entries" not in existing_tables:
        op.create_table(
            "customer_ledger_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("customer_id", sa.String(length=36), nullable=False),
            sa.Column("sale_id", sa.String(length=36), nullable=True),
            sa.Column("kind", sa.String(length=30), nullable=False),
            sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("description", sa.String(length=220), nullable=False),
            sa.Column("reference", sa.String(length=120), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["customer_id"], ["customers.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("customer_ledger_entries")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("customer_ledger_entries")
    }
    if "ix_customer_ledger_customer_created" not in existing_indexes:
        op.create_index(
            "ix_customer_ledger_customer_created",
            "customer_ledger_entries",
            ["customer_id", "created_at"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("customer_ledger_entries")
    }
    if "ix_customer_ledger_entries_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_customer_ledger_entries_business_id"),
            "customer_ledger_entries",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("customer_ledger_entries")
    }
    if "ix_customer_ledger_entries_customer_id" not in existing_indexes:
        op.create_index(
            op.f("ix_customer_ledger_entries_customer_id"),
            "customer_ledger_entries",
            ["customer_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("customer_ledger_entries")
    }
    if "ix_customer_ledger_entries_sale_id" not in existing_indexes:
        op.create_index(
            op.f("ix_customer_ledger_entries_sale_id"),
            "customer_ledger_entries",
            ["sale_id"],
            unique=False,
        )
    if "invoices" not in existing_tables:
        op.create_table(
            "invoices",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("order_id", sa.String(length=36), nullable=False),
            sa.Column("invoice_number", sa.String(length=50), nullable=False),
            sa.Column(
                "total_amount", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "invoice_number", name="uq_invoice_business_number"
            ),
        )
        existing_tables.add("invoices")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("invoices")
    }
    if "ix_invoices_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_invoices_business_id"), "invoices", ["business_id"], unique=False
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("invoices")
    }
    if "ix_invoices_business_order" not in existing_indexes:
        op.create_index(
            "ix_invoices_business_order",
            "invoices",
            ["business_id", "order_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("invoices")
    }
    if "ix_invoices_order_id" not in existing_indexes:
        op.create_index(
            op.f("ix_invoices_order_id"), "invoices", ["order_id"], unique=False
        )
    if "product_variants" not in existing_tables:
        op.create_table(
            "product_variants",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("product_id", sa.String(length=36), nullable=False),
            sa.Column("unit_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("sku", sa.String(length=80), nullable=False),
            sa.Column("barcode", sa.String(length=100), nullable=True),
            sa.Column(
                "purchase_price", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column(
                "selling_price", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column(
                "low_stock_threshold", sa.Numeric(precision=18, scale=3), nullable=False
            ),
            sa.Column("track_stock", sa.Boolean(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["product_id"], ["products.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["unit_id"],
                ["units.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "barcode", name="uq_variant_business_barcode"
            ),
            sa.UniqueConstraint("business_id", "sku", name="uq_variant_business_sku"),
        )
        existing_tables.add("product_variants")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("product_variants")
    }
    if "ix_product_variants_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_product_variants_business_id"),
            "product_variants",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("product_variants")
    }
    if "ix_product_variants_product_id" not in existing_indexes:
        op.create_index(
            op.f("ix_product_variants_product_id"),
            "product_variants",
            ["product_id"],
            unique=False,
        )
    if "sale_payments" not in existing_tables:
        op.create_table(
            "sale_payments",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("sale_id", sa.String(length=36), nullable=False),
            sa.Column("method", sa.String(length=25), nullable=False),
            sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("reference", sa.String(length=120), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("note", sa.String(length=220), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("sale_payments")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sale_payments")
    }
    if "ix_sale_payments_sale_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sale_payments_sale_id"), "sale_payments", ["sale_id"], unique=False
        )
    if "sale_refunds" not in existing_tables:
        op.create_table(
            "sale_refunds",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("sale_id", sa.String(length=36), nullable=False),
            sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("reason", sa.String(length=220), nullable=False),
            sa.Column("note", sa.String(length=220), nullable=True),
            sa.Column("idempotency_key", sa.String(length=128), nullable=True),
            sa.Column("request_hash", sa.String(length=64), nullable=True),
            sa.Column("items_json", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("sale_refunds")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sale_refunds")
    }
    if "ix_sale_refunds_sale_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sale_refunds_sale_id"), "sale_refunds", ["sale_id"], unique=False
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sale_refunds")
    }
    if "uq_sale_refund_idempotency" not in existing_indexes:
        op.create_index(
            "uq_sale_refund_idempotency",
            "sale_refunds",
            ["sale_id", "idempotency_key"],
            unique=True,
        )
    if "supplier_payments" not in existing_tables:
        op.create_table(
            "supplier_payments",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=True),
            sa.Column("supplier_id", sa.String(length=36), nullable=False),
            sa.Column("purchase_id", sa.String(length=36), nullable=True),
            sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("method", sa.String(length=30), nullable=False),
            sa.Column("reference", sa.String(length=120), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("reversal_of_id", sa.String(length=36), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["purchase_id"], ["purchases.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["supplier_id"], ["suppliers.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("supplier_payments")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("supplier_payments")
    }
    if "ix_supplier_payments_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_supplier_payments_business_id"),
            "supplier_payments",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("supplier_payments")
    }
    if "ix_supplier_payments_purchase_id" not in existing_indexes:
        op.create_index(
            op.f("ix_supplier_payments_purchase_id"),
            "supplier_payments",
            ["purchase_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("supplier_payments")
    }
    if "ix_supplier_payments_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_supplier_payments_store_id"),
            "supplier_payments",
            ["store_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("supplier_payments")
    }
    if "ix_supplier_payments_supplier_id" not in existing_indexes:
        op.create_index(
            op.f("ix_supplier_payments_supplier_id"),
            "supplier_payments",
            ["supplier_id"],
            unique=False,
        )
    if "inventory_balances" not in existing_tables:
        op.create_table(
            "inventory_balances",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=False),
            sa.Column("variant_id", sa.String(length=36), nullable=False),
            sa.Column("quantity", sa.Numeric(precision=18, scale=3), nullable=False),
            sa.Column(
                "average_cost", sa.Numeric(precision=18, scale=2), nullable=False
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["variant_id"], ["product_variants.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id",
                "store_id",
                "variant_id",
                name="uq_inventory_balance_scope",
            ),
        )
        existing_tables.add("inventory_balances")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("inventory_balances")
    }
    if "ix_inventory_balances_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_inventory_balances_business_id"),
            "inventory_balances",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("inventory_balances")
    }
    if "ix_inventory_balances_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_inventory_balances_store_id"),
            "inventory_balances",
            ["store_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("inventory_balances")
    }
    if "ix_inventory_balances_variant_id" not in existing_indexes:
        op.create_index(
            op.f("ix_inventory_balances_variant_id"),
            "inventory_balances",
            ["variant_id"],
            unique=False,
        )
    if "order_items" not in existing_tables:
        op.create_table(
            "order_items",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("order_id", sa.String(length=36), nullable=False),
            sa.Column("variant_id", sa.String(length=36), nullable=False),
            sa.Column("product_name", sa.String(length=180), nullable=False),
            sa.Column("variant_name", sa.String(length=180), nullable=False),
            sa.Column("sku", sa.String(length=80), nullable=False),
            sa.Column("quantity", sa.Numeric(precision=18, scale=3), nullable=False),
            sa.Column("unit_price", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("line_total", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["variant_id"], ["product_variants.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("order_items")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("order_items")
    }
    if "ix_order_items_order_id" not in existing_indexes:
        op.create_index(
            op.f("ix_order_items_order_id"), "order_items", ["order_id"], unique=False
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("order_items")
    }
    if "ix_order_items_variant_id" not in existing_indexes:
        op.create_index(
            op.f("ix_order_items_variant_id"),
            "order_items",
            ["variant_id"],
            unique=False,
        )
    if "purchase_items" not in existing_tables:
        op.create_table(
            "purchase_items",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("purchase_id", sa.String(length=36), nullable=False),
            sa.Column("variant_id", sa.String(length=36), nullable=False),
            sa.Column("quantity", sa.Numeric(precision=18, scale=3), nullable=False),
            sa.Column("unit_cost", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column(
                "conversion_factor", sa.Numeric(precision=18, scale=6), nullable=False
            ),
            sa.Column("line_total", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.ForeignKeyConstraint(
                ["purchase_id"], ["purchases.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["variant_id"],
                ["product_variants.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("purchase_items")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("purchase_items")
    }
    if "ix_purchase_items_purchase_id" not in existing_indexes:
        op.create_index(
            op.f("ix_purchase_items_purchase_id"),
            "purchase_items",
            ["purchase_id"],
            unique=False,
        )
    if "sale_items" not in existing_tables:
        op.create_table(
            "sale_items",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("sale_id", sa.String(length=36), nullable=False),
            sa.Column("variant_id", sa.String(length=36), nullable=False),
            sa.Column("product_name", sa.String(length=180), nullable=False),
            sa.Column("variant_name", sa.String(length=180), nullable=False),
            sa.Column("sku", sa.String(length=80), nullable=False),
            sa.Column("quantity", sa.Numeric(precision=18, scale=3), nullable=False),
            sa.Column("unit_price", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("line_total", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("unit_cost", sa.Numeric(precision=18, scale=2), nullable=True),
            sa.ForeignKeyConstraint(["sale_id"], ["sales.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["variant_id"], ["product_variants.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("sale_items")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sale_items")
    }
    if "ix_sale_items_sale_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sale_items_sale_id"), "sale_items", ["sale_id"], unique=False
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("sale_items")
    }
    if "ix_sale_items_variant_id" not in existing_indexes:
        op.create_index(
            op.f("ix_sale_items_variant_id"), "sale_items", ["variant_id"], unique=False
        )
    if "stock_movements" not in existing_tables:
        op.create_table(
            "stock_movements",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("store_id", sa.String(length=36), nullable=False),
            sa.Column("variant_id", sa.String(length=36), nullable=False),
            sa.Column("movement_type", sa.String(length=30), nullable=False),
            sa.Column(
                "quantity_delta", sa.Numeric(precision=18, scale=3), nullable=False
            ),
            sa.Column("unit_cost", sa.Numeric(precision=18, scale=2), nullable=False),
            sa.Column("reference_type", sa.String(length=40), nullable=True),
            sa.Column("reference_id", sa.String(length=36), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["business_id"], ["businesses.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["store_id"],
                ["stores.id"],
            ),
            sa.ForeignKeyConstraint(
                ["variant_id"],
                ["product_variants.id"],
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        existing_tables.add("stock_movements")
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("stock_movements")
    }
    if "ix_stock_movements_business_id" not in existing_indexes:
        op.create_index(
            op.f("ix_stock_movements_business_id"),
            "stock_movements",
            ["business_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("stock_movements")
    }
    if "ix_stock_movements_store_id" not in existing_indexes:
        op.create_index(
            op.f("ix_stock_movements_store_id"),
            "stock_movements",
            ["store_id"],
            unique=False,
        )
    existing_indexes = {
        item["name"] for item in sa.inspect(bind).get_indexes("stock_movements")
    }
    if "ix_stock_movements_variant_id" not in existing_indexes:
        op.create_index(
            op.f("ix_stock_movements_variant_id"),
            "stock_movements",
            ["variant_id"],
            unique=False,
        )
    # ### end Alembic commands ###


def downgrade() -> None:
    raise RuntimeError(
        "The initial ShopFlow schema migration is irreversible to protect existing business data."
    )
