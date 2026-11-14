import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine, run_migrations

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    environment = settings.APP_ENV.strip().lower()
    if environment != "test":
        # Keep local development databases in sync with model changes too.
        # create_all() only creates missing tables; it never adds new columns
        # to existing tables, which can otherwise turn reads into 500s.
        run_migrations()
    yield


api_app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="ShopFlow multi-tenant shop management API",
    docs_url=f"{settings.API_V1_PREFIX}/docs",
    redoc_url=f"{settings.API_V1_PREFIX}/redoc",
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

api_app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@api_app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.error("Health check database query failed (%s).", type(error).__name__)
        raise HTTPException(status_code=503, detail="Database unavailable") from error
    return {"status": "ok", "service": "shopflow-backend"}


# Wrap the complete ASGI app so CORS headers are also attached to unhandled
# 500 responses. Otherwise browsers report a CORS failure instead of showing
# the actual server error and its request ID/log context.
app = CORSMiddleware(
    app=api_app,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
