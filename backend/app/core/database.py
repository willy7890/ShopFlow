from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

class Base(DeclarativeBase):
    pass

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.modules.auth import models as auth_models  # noqa: F401
    from app.modules.businesses import models as business_models  # noqa: F401
    from app.modules.catalog import models as catalog_models  # noqa: F401
    from app.modules.customers import models as customers_models  # noqa: F401
    from app.modules.finance import models as finance_models  # noqa: F401
    from app.modules.inventory import models as inventory_models  # noqa: F401
    from app.modules.orders import models as orders_models  # noqa: F401
    from app.modules.sales import models as sales_models  # noqa: F401
    from app.modules.sync import models as sync_models  # noqa: F401
    from app.modules.subscriptions import models as subscriptions_models  # noqa: F401

    Base.metadata.create_all(bind=engine)
