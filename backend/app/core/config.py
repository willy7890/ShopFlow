from pathlib import Path
from urllib.parse import urlsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "ShopFlow API"
    APP_ENV: str = "development"
    RENDER: bool = False
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    SECRET_KEY: str = "unsafe-development-secret-change-me"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 30
    DATABASE_URL: str = "sqlite:///./shopflow.db"
    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:8081,http://127.0.0.1:8081,"
        "http://localhost:8082,http://127.0.0.1:8082"
    )
    SUPER_ADMIN_EMAIL: str = ""
    SUPER_ADMIN_BOOTSTRAP_SECRET: str = ""
    SUBSCRIPTION_PAYMENT_INSTRUCTIONS: str = ""
    EMAIL_VERIFICATION_BASE_URL: str = ""
    PASSWORD_RESET_BASE_URL: str = ""
    EMAIL_VERIFICATION_TOKEN_MINUTES: int = 30
    PASSWORD_RESET_TOKEN_MINUTES: int = 30
    PASSWORD_RESET_RESEND_COOLDOWN_SECONDS: int = 60
    PASSWORD_RESET_MAX_PER_HOUR: int = 5
    EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: int = 60
    EMAIL_VERIFICATION_MAX_PER_HOUR: int = 5
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME: str = "ShopFlow"
    SMTP_STARTTLS: bool = True
    SMTP_USE_SSL: bool = False
    M_PESA_CONSUMER_KEY: str = ""
    M_PESA_CONSUMER_SECRET: str = ""
    M_PESA_PUBLIC_KEY: str = ""
    AI_API_BASE_URL: str = ""
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    AI_TIMEOUT_SECONDS: int = 20

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_flag(cls, value):
        # Hosting shells sometimes export DEBUG=release. It is a deployment
        # label, not a valid boolean, and should never turn debugging on.
        if isinstance(value, str) and value.strip().lower() in {
            "release", "prod", "production", "staging"
        }:
            return False
        if isinstance(value, str) and value.strip().lower() in {
            "debug", "dev", "development"
        }:
            return True
        return value

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("DATABASE_URL")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        database_url = value.strip()
        if not database_url:
            raise ValueError("DATABASE_URL must not be empty.")
        if database_url.startswith("postgres://"):
            return database_url.replace("postgres://", "postgresql+psycopg://", 1)
        if database_url.startswith("postgresql://"):
            return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        if database_url.startswith("postgresql+psycopg2://"):
            return database_url.replace(
                "postgresql+psycopg2://", "postgresql+psycopg://", 1
            )
        return database_url

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        is_production = self.RENDER or self.APP_ENV.strip().lower() in {
            "prod",
            "production",
            "staging",
        }
        if is_production:
            if not self.DATABASE_URL.startswith("postgresql+psycopg://"):
                raise ValueError(
                    "Production deployments must set DATABASE_URL to a PostgreSQL connection URL."
                )
            if (
                self.SECRET_KEY == "unsafe-development-secret-change-me"
                or len(self.SECRET_KEY) < 32
            ):
                raise ValueError(
                    "Production deployments require a SECRET_KEY of at least 32 characters."
                )
            if self.DEBUG:
                raise ValueError("DEBUG must be false outside development.")
        return self

    @property
    def cors_origins(self) -> list[str]:
        configured_origins = [
            origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()
        ]
        if self.APP_ENV.strip().lower() == "development" and not self.RENDER:
            configured_origins.extend(
                origin
                for origin in (
                    "http://localhost:8081",
                    "http://127.0.0.1:8081",
                    "http://localhost:8082",
                    "http://127.0.0.1:8082",
                )
                if origin not in configured_origins
            )
        return configured_origins

    @property
    def smtp_configured(self) -> bool:
        local_development_relay = (
            self.APP_ENV.strip().casefold() == "development"
            and self.SMTP_HOST.strip().casefold() in {"localhost", "127.0.0.1", "::1"}
            and not self.SMTP_USERNAME.strip()
            and not self.SMTP_PASSWORD
        )
        return bool(
            self.SMTP_HOST.strip()
            and self.SMTP_FROM_EMAIL.strip()
            and self.SMTP_FROM_NAME.strip()
            and 1 <= self.SMTP_PORT <= 65535
            and (bool(self.SMTP_USERNAME.strip()) == bool(self.SMTP_PASSWORD))
            and not (self.SMTP_STARTTLS and self.SMTP_USE_SSL)
            and (self.SMTP_STARTTLS or self.SMTP_USE_SSL or local_development_relay)
        )

    @staticmethod
    def _is_secure_public_url(value: str) -> bool:
        base_url = urlsplit(value.strip())
        is_local_http = base_url.scheme == "http" and base_url.hostname in {
            "localhost",
            "127.0.0.1",
            "::1",
        }
        has_secure_url = (
            base_url.scheme == "https" or is_local_http
        ) and bool(base_url.netloc) and not (
            base_url.username or base_url.password or base_url.query or base_url.fragment
        )
        return bool(has_secure_url)

    @property
    def email_delivery_configured(self) -> bool:
        return bool(
            self.smtp_configured
            and self.EMAIL_VERIFICATION_TOKEN_MINUTES > 0
            and self.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS >= 0
            and self.EMAIL_VERIFICATION_MAX_PER_HOUR > 0
            and self._is_secure_public_url(self.EMAIL_VERIFICATION_BASE_URL)
        )

    @property
    def password_reset_delivery_configured(self) -> bool:
        return bool(
            self.smtp_configured
            and self.PASSWORD_RESET_TOKEN_MINUTES > 0
            and self.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS >= 0
            and self.PASSWORD_RESET_MAX_PER_HOUR > 0
            and self._is_secure_public_url(self.PASSWORD_RESET_BASE_URL)
        )


settings = Settings()
