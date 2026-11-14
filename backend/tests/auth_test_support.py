from app.core.database import SessionLocal
from app.modules.auth.models import User


def register_verified_account(client, *, email: str, full_name: str, password: str, business_name: str):
    """Register normally, then verify explicitly as isolated test setup."""
    registered = client.post("/api/v1/auth/register", json={
        "full_name": full_name,
        "email": email,
        "password": password,
        "business_name": business_name,
    })
    assert registered.status_code == 201, registered.text
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email.strip().casefold()).one()
        user.is_email_verified = True
        db.commit()
    logged_in = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert logged_in.status_code == 200, logged_in.text
    return logged_in.json(), registered.json()
