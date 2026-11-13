import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine, init_db, run_migrations

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    environment = settings.APP_ENV.strip().lower()
    if environment == "development" and not settings.RENDER:
        init_db()
    elif environment != "test":
        run_migrations()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="ShopFlow multi-tenant shop management API",
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    redoc_url=f"{settings.API_V1_PREFIX}/redoc",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.error("Health check database query failed (%s).", type(error).__name__)
        raise HTTPException(status_code=503, detail="Database unavailable") from error
    return {"status": "ok", "service": "shopflow-backend"}
