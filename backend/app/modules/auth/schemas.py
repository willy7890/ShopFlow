from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=12, max_length=128)
    business_name: str = Field(min_length=2, max_length=180)
    business_type: str = Field(default="retail", max_length=60)
    country_code: str = Field(default="TZ", min_length=2, max_length=2, pattern="^[A-Z]{2}$")
    currency: str = Field(default="TZS", min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    preferred_language: str = Field(default="sw", pattern="^(sw|en)$")

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if not any(char.islower() for char in value) or not any(char.isupper() for char in value) or not any(char.isdigit() for char in value) or not any(not char.isalnum() for char in value):
            raise ValueError("Password must include uppercase and lowercase letters, a number, and a symbol.")
        return value
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().casefold() if isinstance(value, str) else value


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


class RegistrationOut(BaseModel):
    full_name: str
    email: EmailStr
    verification_required: bool = True
    email_sent: bool
    delivery_configured: bool
    message: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().casefold() if isinstance(value, str) else value


class ResendVerificationOut(BaseModel):
    message: str
    delivery_configured: bool
    delivery_sent: bool | None = None


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=32, max_length=200)


class VerifyEmailOut(BaseModel):
    verified: bool = True
    message: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().casefold() if isinstance(value, str) else value


class ForgotPasswordOut(BaseModel):
    message: str


class PasswordResetRequest(BaseModel):
    token: str = Field(min_length=32, max_length=200)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if not any(char.islower() for char in value) or not any(char.isupper() for char in value) or not any(char.isdigit() for char in value) or not any(not char.isalnum() for char in value):
            raise ValueError("Password must include uppercase and lowercase letters, a number, and a symbol.")
        return value
