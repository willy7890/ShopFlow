from pydantic import BaseModel, ConfigDict, Field


class BusinessCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    business_type: str = Field(default="retail", max_length=60)
    operating_mode: str = Field(default="smart_inventory", pattern="^(smart_inventory|quick_sales)$")
    country_code: str = Field(default="TZ", min_length=2, max_length=2, pattern="^[A-Z]{2}$")
    currency: str = Field(default="TZS", min_length=3, max_length=3, pattern="^[A-Z]{3}$")


class BusinessOut(BaseModel):
    id: str
    name: str
    business_type: str
    country_code: str
    currency: str
    operating_mode: str
    model_config = ConfigDict(from_attributes=True)


class StoreCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    code: str = Field(min_length=2, max_length=32, pattern="^[A-Za-z0-9_-]+$")
    address: str | None = Field(default=None, max_length=255)


class StoreOut(BaseModel):
    id: str
    business_id: str
    name: str
    code: str
    address: str | None
    model_config = ConfigDict(from_attributes=True)


class BusinessAccessOut(BaseModel):
    business_id: str
    business_name: str
    currency: str
    role: str
    store_ids: list[str]
    permissions: list[str]
    stores: list[StoreOut]
