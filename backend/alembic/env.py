from alembic import context
from app.core.database import Base, engine
from app.modules.audit import models as audit_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.businesses import models as business_models  # noqa: F401
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.customers import models as customers_models  # noqa: F401
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.inventory import models as inventory_models  # noqa: F401
from app.modules.orders import models as orders_models  # noqa: F401
from app.modules.sales import models as sales_models  # noqa: F401
from app.modules.subscriptions import models as subscriptions_models  # noqa: F401
from app.modules.sync import models as sync_models  # noqa: F401

config = context.config


def run_migrations_offline() -> None:
    raise RuntimeError("ShopFlow migrations require a live database connection.")


def _run_migrations(connection) -> None:
    context.configure(
        connection=connection, target_metadata=Base.metadata, compare_type=True
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run_migrations(connection)
        return

    with engine.connect() as connection:
        _run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
