from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AssetType = Literal["barrier", "sign", "speed_limit", "queue_sensor"]
ProjectStatus = Literal["Active", "Planned", "Complete"]
ImpactLevel = Literal["Low", "Moderate", "High"]
FatigueLevel = Literal["Clear", "Check-in due", "Relief recommended"]
AlertType = Literal["Emergency", "Hazard"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    location: str = Field(min_length=2, max_length=160)
    status: ProjectStatus = "Planned"
    lanes_closed: int = Field(ge=0, le=3)
    duration_days: int = Field(ge=1, le=365)
    radius_meters: int = Field(default=250, ge=25, le=5000)
    coordinates: tuple[float, float]


class Project(ProjectCreate):
    id: str


class AssetCreate(BaseModel):
    project_id: str
    type: AssetType
    label: str = Field(min_length=2, max_length=120)
    value: str | None = None
    coordinates: tuple[float, float]


class TrafficAsset(AssetCreate):
    id: str


class ImpactScenario(BaseModel):
    project_id: str
    lanes_closed: int = Field(ge=0, le=3)
    duration_days: int = Field(ge=1, le=365)
    speed_limit_kmh: int = Field(ge=20, le=110)


class ImpactEstimate(BaseModel):
    estimated_delay_minutes: int
    traffic_impact: ImpactLevel
    transit_impact: ImpactLevel
    affected_routes: list[str]
    note: str


class GateController(BaseModel):
    id: str
    project_id: str
    gatepoint: str
    controller_label: str
    fatigue_level: FatigueLevel
    last_check_in: str
    coordinates: tuple[float, float]


class GateControllerCreate(BaseModel):
    project_id: str
    gatepoint: str = Field(min_length=2, max_length=80)
    controller_label: str = Field(min_length=2, max_length=40)
    fatigue_level: FatigueLevel = "Clear"
    last_check_in: str = "Just now"
    coordinates: tuple[float, float]


class GateControllerPositionUpdate(BaseModel):
    coordinates: tuple[float, float]


class SiteAlertCreate(BaseModel):
    project_id: str
    gatepoint_id: str
    alert_type: AlertType
    details: str = Field(min_length=5, max_length=500)


class SiteAlert(SiteAlertCreate):
    id: str
    created_at: str
    status: str = "Logged locally — no external dispatch"
