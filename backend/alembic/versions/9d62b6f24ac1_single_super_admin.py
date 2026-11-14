"""ensure only one Super Admin flag exists

Revision ID: 9d62b6f24ac1
Revises: 87dd623efc1a
Create Date: 2026-11-14
"""

import sqlalchemy as sa
from alembic import op

revision = "9d62b6f24ac1"
down_revision = "87dd623efc1a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return

    # A migration may add the invariant, but it must never grant or transfer
    # platform privileges. Resolve any identity conflict through the audited,
    # authenticated Super Admin recovery endpoint before deploying this index.
    users = sa.table(
        "users",
        sa.column("is_super_admin", sa.Boolean()),
    )
    admin_count = bind.execute(
        sa.select(sa.func.count()).select_from(users).where(users.c.is_super_admin.is_(True))
    ).scalar_one()
    if admin_count > 1:
        raise RuntimeError(
            "Multiple Super Admin identities exist. Reconcile them through the audited recovery flow before retrying."
        )

    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("users")}
    if "uq_users_single_super_admin" not in indexes:
        op.create_index(
            "uq_users_single_super_admin",
            "users",
            ["is_super_admin"],
            unique=True,
            sqlite_where=sa.text("is_super_admin = 1"),
            postgresql_where=sa.text("is_super_admin IS TRUE"),
        )


def downgrade() -> None:
    raise RuntimeError("ShopFlow database migrations are forward-only to protect application data.")
