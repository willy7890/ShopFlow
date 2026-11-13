import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_render_postgres_urls_use_psycopg_driver():
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        DATABASE_URL="postgres://db.internal/shopflow",
        SECRET_KEY="s" * 48,
    )
    assert settings.DATABASE_URL == "postgresql+psycopg://db.internal/shopflow"


def test_production_rejects_sqlite_and_weak_secrets():
    with pytest.raises(ValidationError, match="PostgreSQL connection URL"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            DATABASE_URL="sqlite:///./shopflow.db",
            SECRET_KEY="s" * 48,
        )

    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(
            _env_file=None,
            APP_ENV="production",
            DATABASE_URL="postgresql://db.internal/shopflow",
            SECRET_KEY="short",
        )

    with pytest.raises(ValidationError, match="PostgreSQL connection URL"):
        Settings(
            _env_file=None,
            RENDER=True,
            DATABASE_URL="sqlite:///./shopflow.db",
            SECRET_KEY="s" * 48,
        )


def test_development_keeps_sqlite_support():
    settings = Settings(
        _env_file=None,
        APP_ENV="development",
        DATABASE_URL="sqlite:///./shopflow.db",
    )
    assert settings.DATABASE_URL == "sqlite:///./shopflow.db"
