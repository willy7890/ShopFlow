"""add platform subscription payments and user activity fields

Revision ID: c4a8d2e7b116
Revises: b87f13c0d24e
Create Date: 2026-11-14
"""

import sqlalchemy as sa
from alembic import op

revision = "c4a8d2e7b116"
down_revision = "b87f13c0d24e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("users")}
        if "last_login_at" not in columns:
            op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    if "subscription_plans" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("subscription_plans")}
        if "archived_at" not in columns:
            op.add_column("subscription_plans", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    if "subscription_payments" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "subscription_payments",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("business_id", sa.String(length=36), nullable=False),
            sa.Column("subscription_id", sa.String(length=36), nullable=False),
            sa.Column("plan_id", sa.String(length=36), nullable=True),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("currency", sa.String(length=3), nullable=False),
            sa.Column("payment_method", sa.String(length=40), nullable=False),
            sa.Column("transaction_reference", sa.String(length=160), nullable=True),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("confirmation_user_id", sa.String(length=36), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("confirmation_details", sa.Text(), nullable=True),
            sa.Column("refund_amount", sa.Numeric(12, 2), nullable=True),
            sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("refund_details", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["subscription_id"], ["business_subscriptions.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["plan_id"], ["subscription_plans.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["confirmation_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("transaction_reference", name="uq_subscription_payment_reference"),
        )
    indexes = {item["name"] for item in sa.inspect(bind).get_indexes("subscription_payments")}
    if "ix_subscription_payment_business_paid" not in indexes:
        op.create_index("ix_subscription_payment_business_paid", "subscription_payments", ["business_id", "paid_at"])
    if "ix_subscription_payment_status_paid" not in indexes:
        op.create_index("ix_subscription_payment_status_paid", "subscription_payments", ["status", "paid_at"])
    if "ix_subscription_payments_business_id" not in indexes:
        op.create_index("ix_subscription_payments_business_id", "subscription_payments", ["business_id"])
    if "ix_subscription_payments_subscription_id" not in indexes:
        op.create_index("ix_subscription_payments_subscription_id", "subscription_payments", ["subscription_id"])


def downgrade() -> None:
    raise RuntimeError("ShopFlow database migrations are forward-only to protect application and payment records.")
