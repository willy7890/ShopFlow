"""add single-use email verification tokens

Revision ID: 87dd623efc1a
Revises: 4860a7f6ea2b
Create Date: 2026-11-13
"""

import sqlalchemy as sa
from alembic import op

revision = "87dd623efc1a"
down_revision = "4860a7f6ea2b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "email_verification_tokens" not in inspector.get_table_names():
        op.create_table(
            "email_verification_tokens",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
    inspector = sa.inspect(op.get_bind())
    existing_indexes = {
        item["name"] for item in inspector.get_indexes("email_verification_tokens")
    }
    if "ix_email_verification_tokens_user_id" not in existing_indexes:
        op.create_index(
            "ix_email_verification_tokens_user_id",
            "email_verification_tokens",
            ["user_id"],
        )
    if "ix_email_verification_user_created" not in existing_indexes:
        op.create_index(
            "ix_email_verification_user_created",
            "email_verification_tokens",
            ["user_id", "created_at"],
        )


def downgrade() -> None:
    raise RuntimeError("ShopFlow database migrations are forward-only to protect application data.")
