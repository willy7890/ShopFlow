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
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    SUPER_ADMIN_EMAIL: str = ""
    SUPER_ADMIN_BOOTSTRAP_SECRET: str = ""
    M_PESA_CONSUMER_KEY: str = ""
    M_PESA_CONSUMER_SECRET: str = ""
    M_PESA_PUBLIC_KEY: str = ""
    AI_API_BASE_URL: str = ""
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    AI_TIMEOUT_SECONDS: int = 20

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
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
        return [
            origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()
        ]


settings = Settings()
