"""add subscription plan descriptions and trial duration

Revision ID: b87f13c0d24e
Revises: 9d62b6f24ac1
Create Date: 2026-11-14
"""

import sqlalchemy as sa
from alembic import op

revision = "b87f13c0d24e"
down_revision = "9d62b6f24ac1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "subscription_plans" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("subscription_plans")}
    if "description" not in columns:
        op.add_column("subscription_plans", sa.Column("description", sa.String(length=500), nullable=True))
    if "trial_days" not in columns:
        op.add_column(
            "subscription_plans",
            sa.Column("trial_days", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    raise RuntimeError("ShopFlow database migrations are forward-only to protect application data.")
