"""Preserve existing subscription access during entitlement rollout.

Revision ID: f1c24b9d6a30
Revises: c4a8d2e7b116
"""

import sqlalchemy as sa
from alembic import op


revision = "f1c24b9d6a30"
down_revision = "c4a8d2e7b116"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "subscription_plans" in tables:
        columns = {column["name"] for column in inspector.get_columns("subscription_plans")}
        if "entitlement_schema_version" not in columns:
            # Existing plans need owner review. A zero version is deliberately
            # unconfigured and cannot be used for newly enforced subscriptions.
            op.add_column(
                "subscription_plans",
                sa.Column("entitlement_schema_version", sa.Integer(), nullable=False, server_default="0"),
            )
    if "business_subscriptions" in tables:
        columns = {column["name"] for column in inspector.get_columns("business_subscriptions")}
        if "entitlement_mode" not in columns:
            # Add the safe default first, then explicitly preserve every
            # pre-rollout row. Future inserts that omit this column must fail
            # closed under entitlement enforcement rather than inherit legacy
            # access accidentally.
            op.add_column(
                "business_subscriptions",
                sa.Column("entitlement_mode", sa.String(length=24), nullable=False, server_default="enforced"),
            )
            op.execute(sa.text("UPDATE business_subscriptions SET entitlement_mode = 'legacy'"))


def downgrade() -> None:
    raise RuntimeError("ShopFlow database migrations are forward-only to protect subscription access records.")
