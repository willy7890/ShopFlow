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


def test_debug_parser_treats_release_profile_as_disabled():
    settings = Settings(_env_file=None, DEBUG="release")
    assert settings.DEBUG is False
    assert Settings(_env_file=None, DEBUG="development").DEBUG is True


def test_development_cors_allows_expo_web_origins():
    settings = Settings(
        _env_file=None,
        APP_ENV="development",
        CORS_ORIGINS="http://localhost:5173",
    )

    assert "http://localhost:8081" in settings.cors_origins
    assert "http://127.0.0.1:8081" in settings.cors_origins
    assert "http://localhost:8082" in settings.cors_origins
    assert "http://127.0.0.1:8082" in settings.cors_origins
    assert "http://localhost:5173" in settings.cors_origins


def test_email_delivery_is_not_reported_configured_without_provider_and_url():
    settings = Settings(
        _env_file=None,
        SMTP_HOST="",
        SMTP_FROM_EMAIL="",
        SMTP_USERNAME="",
        SMTP_PASSWORD="",
        EMAIL_VERIFICATION_BASE_URL="",
    )
    assert settings.email_delivery_configured is False


def test_email_delivery_requires_complete_tls_configuration():
    configured = Settings(
        _env_file=None,
        SMTP_HOST="smtp.example.test",
        SMTP_PORT=587,
        SMTP_USERNAME="mailer",
        SMTP_PASSWORD="secret",
        SMTP_FROM_EMAIL="noreply@example.test",
        SMTP_STARTTLS=True,
        SMTP_USE_SSL=False,
        EMAIL_VERIFICATION_BASE_URL="https://api.example.test/api/v1/auth/verify-email",
    )
    assert configured.email_delivery_configured is True
    assert configured.model_copy(update={"SMTP_PASSWORD": "", "SMTP_STARTTLS": False}).email_delivery_configured is False


def test_production_does_not_add_development_cors_origins():
    settings = Settings(
        _env_file=None,
        APP_ENV="production",
        DATABASE_URL="postgresql://db.internal/shopflow",
        SECRET_KEY="s" * 48,
        CORS_ORIGINS="https://shopflow.example",
    )

    assert settings.cors_origins == ["https://shopflow.example"]
