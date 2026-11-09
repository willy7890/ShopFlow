from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    business_name: str = Field(min_length=2, max_length=180)
    business_type: str = Field(default="retail", max_length=60)
    country_code: str = Field(default="TZ", min_length=2, max_length=2, pattern="^[A-Z]{2}$")
    currency: str = Field(default="TZS", min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    preferred_language: str = Field(default="sw", pattern="^(sw|en)$")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    phone: str | None
    preferred_language: str
    is_super_admin: bool = False
    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
