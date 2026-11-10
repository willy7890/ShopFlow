from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "ShopFlow API"
    APP_ENV: str = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    SECRET_KEY: str = "unsafe-development-secret-change-me"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 30
    DATABASE_URL: str = "sqlite:///./shopflow.db"
    CORS_ORIGINS: str = "http://localhost:5173"
    SUPER_ADMIN_EMAIL: str = ""
    SUPER_ADMIN_BOOTSTRAP_SECRET: str = ""
    M_PESA_CONSUMER_KEY: str = ""
    M_PESA_CONSUMER_SECRET: str = ""
    M_PESA_PUBLIC_KEY: str = ""
    AI_API_BASE_URL: str = ""
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    AI_TIMEOUT_SECONDS: int = 20

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


settings = Settings()
