import os
from tempfile import TemporaryDirectory

import pytest

_test_database_directory = TemporaryDirectory(prefix="shopflow-tests-")
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{_test_database_directory.name}/shopflow-test.db"


@pytest.fixture(autouse=True)
def isolate_database_per_test():
    from app.core.database import Base, engine, init_db

    init_db()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def prevent_unrequested_email_delivery(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "SMTP_USERNAME", "")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "")
