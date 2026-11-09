from pydantic import BaseModel, ConfigDict, Field
from decimal import Decimal

class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: str | None = None
    description: str | None = None

class CategoryOut(BaseModel):
    id: str; business_id: str; name: str; parent_id: str | None; description: str | None
    model_config = ConfigDict(from_attributes=True)

class BrandCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class BrandOut(BaseModel):
    id: str; business_id: str; name: str
    model_config = ConfigDict(from_attributes=True)

class UnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    code: str = Field(min_length=1, max_length=20)
    base_unit_id: str | None = None
    factor_to_base: Decimal = Field(default=Decimal("1"), gt=0)

class UnitOut(BaseModel):
    id: str; business_id: str; name: str; code: str; base_unit_id: str | None; factor_to_base: Decimal
    model_config = ConfigDict(from_attributes=True)

class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    category_id: str | None = None
    brand_id: str | None = None
    description: str | None = None
    image_url: str | None = None

class ProductOut(BaseModel):
    id: str; business_id: str; name: str; category_id: str | None; brand_id: str | None
    description: str | None; image_url: str | None; is_active: bool
    model_config = ConfigDict(from_attributes=True)

class VariantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit_id: str
    sku: str = Field(min_length=1, max_length=80)
    barcode: str | None = Field(default=None, max_length=100)
    purchase_price: Decimal = Field(default=Decimal("0"), ge=0)
    selling_price: Decimal = Field(default=Decimal("0"), ge=0)
    low_stock_threshold: Decimal = Field(default=Decimal("0"), ge=0)
    track_stock: bool = True

class VariantOut(BaseModel):
    id: str; business_id: str; product_id: str; unit_id: str; name: str; sku: str
    barcode: str | None; purchase_price: Decimal; selling_price: Decimal
    low_stock_threshold: Decimal; track_stock: bool; is_active: bool
    model_config = ConfigDict(from_attributes=True)
