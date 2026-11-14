from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SyncDeviceCreate(BaseModel):
    device_name: str = Field(min_length=2, max_length=120)
    device_type: str = Field(default="web", max_length=40)
    platform: str | None = Field(default=None, max_length=80)


class SyncDeviceOut(BaseModel):
    id: str
    business_id: str
    user_id: str
    device_name: str
    device_type: str
    platform: str | None
    last_sync_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)


class SyncPushItem(BaseModel):
    clientId: str | None = None
    client_id: str | None = None
    idempotency_key: str | None = None
    store_id: str | None = None
    items: list[dict] = Field(default_factory=list)
    payments: list[dict] = Field(default_factory=list)
    customer_id: str | None = None
    customer: str | None = None
    description: str | None = None


class SyncPushRequest(BaseModel):
    items: list[dict] = Field(default_factory=list)


class SyncPushResult(BaseModel):
    client_id: str
    state: str
    message: str | None = None


class SyncStatusOut(BaseModel):
    device_id: str | None = None
    pending_count: int
    synced_count: int
    failed_count: int
    total_count: int


class SyncOperationOut(BaseModel):
    id: str
    entity_type: str
    operation_name: str
    status: str
    idempotency_key: str
    created_at: str
    result_message: str | None = None
    error_message: str | None = None
    model_config = ConfigDict(from_attributes=True)
