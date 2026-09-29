from datetime import datetime, timezone
from math import cos, pi
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    AssetCreate,
    FatigueLevel,
    GateController,
    GateControllerCreate,
    GateControllerPositionUpdate,
    ImpactEstimate,
    ImpactScenario,
    Project,
    ProjectCreate,
    SiteAlert,
    SiteAlertCreate,
    TrafficAsset,
)

app = FastAPI(
    title="Traffic Management System API",
    version="0.1.0",
    description="Prototype API for work zones, traffic-control assets, and indicative scenarios.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

projects: list[Project] = [
    Project(
        id="prj-01", name="CityLink resurfacing", location="West Melbourne · Dynon Rd",
        status="Active", lanes_closed=1, duration_days=4, radius_meters=350, coordinates=(144.926, -37.807),
    ),
    Project(
        id="prj-02", name="Tram stop accessibility", location="Carlton · Swanston St",
        status="Planned", lanes_closed=1, duration_days=12, radius_meters=220, coordinates=(144.965, -37.801),
    ),
    Project(
        id="prj-03", name="Water main renewal", location="Southbank · City Rd",
        status="Active", lanes_closed=2, duration_days=7, radius_meters=280, coordinates=(144.961, -37.829),
    ),
]
assets: list[TrafficAsset] = [
    TrafficAsset(id="ast-01", project_id="prj-01", type="barrier", label="Concrete barrier", coordinates=(144.923, -37.805)),
    TrafficAsset(id="ast-02", project_id="prj-01", type="sign", label="Road works ahead", coordinates=(144.931, -37.809)),
    TrafficAsset(id="ast-03", project_id="prj-02", type="speed_limit", label="Temporary speed limit", value="40 km/h", coordinates=(144.969, -37.799)),
    TrafficAsset(id="ast-04", project_id="prj-03", type="barrier", label="Lane closure barrier", coordinates=(144.957, -37.827)),
]
site_alerts: list[SiteAlert] = []
gatepoint_position_overrides: dict[str, tuple[float, float]] = {}
added_gate_controllers: list[GateController] = []


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/projects", response_model=list[Project])
def list_projects() -> list[Project]:
    return projects


@app.post("/projects", response_model=Project, status_code=201)
def create_project(project: ProjectCreate) -> Project:
    saved = Project(id=f"prj-{uuid4().hex[:8]}", **project.model_dump())
    projects.append(saved)
    return saved


@app.get("/assets", response_model=list[TrafficAsset])
def list_assets() -> list[TrafficAsset]:
    return assets


@app.get("/gate-controllers", response_model=list[GateController])
def list_gate_controllers(project_id: str | None = None) -> list[GateController]:
    gate_directions = [
        ("North gate", 0, 1),
        ("East gate", 1, 0),
        ("South gate", 0, -1),
        ("West gate", -1, 0),
    ]
    fatigue_levels: list[FatigueLevel] = ["Clear", "Check-in due", "Clear", "Relief recommended"]
    check_in_times = ["6 min ago", "28 min ago", "11 min ago", "34 min ago"]
    controllers: list[GateController] = []
    for project_index, project in enumerate(projects):
        if project_id and project.id != project_id:
            continue
        latitude_scale = 111_320
        longitude_scale = latitude_scale * cos(project.coordinates[1] * pi / 180)
        for gate_index, (gatepoint, east_west, north_south) in enumerate(gate_directions):
            offset_meters = project.radius_meters + 25
            controller_number = project_index * len(gate_directions) + gate_index + 1
            controllers.append(
                GateController(
                    id=f"{project.id}-{gatepoint.split()[0].lower()}",
                    project_id=project.id,
                    gatepoint=gatepoint,
                    controller_label=f"TC-{controller_number:02d}",
                    fatigue_level=fatigue_levels[(project_index + gate_index) % len(fatigue_levels)],
                    last_check_in=check_in_times[gate_index],
                    coordinates=gatepoint_position_overrides.get(
                        f"{project.id}-{gatepoint.split()[0].lower()}",
                        (
                            project.coordinates[0] + east_west * offset_meters / longitude_scale,
                            project.coordinates[1] + north_south * offset_meters / latitude_scale,
                        ),
                    ),
                )
            )
    controllers.extend(
        controller.model_copy(
            update={
                "coordinates": gatepoint_position_overrides.get(
                    controller.id,
                    controller.coordinates,
                )
            }
        )
        for controller in added_gate_controllers
        if not project_id or controller.project_id == project_id
    )
    return controllers


@app.post("/gate-controllers", response_model=GateController, status_code=201)
def create_gate_controller(controller: GateControllerCreate) -> GateController:
    if not any(project.id == controller.project_id for project in projects):
        raise HTTPException(status_code=404, detail="Project not found")
    if any(
        existing.project_id == controller.project_id
        and existing.gatepoint.casefold() == controller.gatepoint.casefold()
        for existing in list_gate_controllers(controller.project_id)
    ):
        raise HTTPException(status_code=409, detail="A controller already exists at this gatepoint")
    saved = GateController(id=f"gate-{uuid4().hex[:8]}", **controller.model_dump())
    added_gate_controllers.append(saved)
    return saved


@app.patch("/gate-controllers/{gatepoint_id}/position", response_model=GateController)
def update_gate_controller_position(
    gatepoint_id: str,
    position: GateControllerPositionUpdate,
) -> GateController:
    controller = next(
        (item for item in list_gate_controllers() if item.id == gatepoint_id),
        None,
    )
    if controller is None:
        raise HTTPException(status_code=404, detail="Gatepoint not found")
    gatepoint_position_overrides[gatepoint_id] = position.coordinates
    return controller.model_copy(update={"coordinates": position.coordinates})


@app.get("/alerts", response_model=list[SiteAlert])
def list_site_alerts() -> list[SiteAlert]:
    return site_alerts


@app.post("/alerts", response_model=SiteAlert, status_code=201)
def create_site_alert(alert: SiteAlertCreate) -> SiteAlert:
    if not any(project.id == alert.project_id for project in projects):
        raise HTTPException(status_code=404, detail="Project not found")
    if not any(controller.id == alert.gatepoint_id for controller in list_gate_controllers(alert.project_id)):
        raise HTTPException(status_code=404, detail="Gatepoint not found for project")
    saved = SiteAlert(
        id=f"alert-{uuid4().hex[:8]}",
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **alert.model_dump(),
    )
    site_alerts.append(saved)
    return saved


@app.post("/assets", response_model=TrafficAsset, status_code=201)
def create_asset(asset: AssetCreate) -> TrafficAsset:
    if not any(project.id == asset.project_id for project in projects):
        raise HTTPException(status_code=404, detail="Project not found")
    saved = TrafficAsset(id=f"ast-{uuid4().hex[:8]}", **asset.model_dump())
    assets.append(saved)
    return saved


@app.post("/scenarios/estimate", response_model=ImpactEstimate)
def estimate_scenario(scenario: ImpactScenario) -> ImpactEstimate:
    project = next((item for item in projects if item.id == scenario.project_id), None)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    delay = max(
        2,
        round(
            2
            + scenario.lanes_closed * 4
            + min(scenario.duration_days, 21) * 0.45
            + (80 - scenario.speed_limit_kmh) * 0.08
        ),
    )
    traffic_impact = "High" if delay >= 13 else "Moderate" if delay >= 7 else "Low"
    transit_impact = (
        "Moderate"
        if "tram" in project.name.lower() or "city" in project.name.lower()
        else "Moderate" if traffic_impact == "High" else "Low"
    )
    routes = ["Route 96", "Route 109"] if transit_impact == "Moderate" else ["Route 12"]
    return ImpactEstimate(
        estimated_delay_minutes=delay,
        traffic_impact=traffic_impact,
        transit_impact=transit_impact,
        affected_routes=routes,
        note="Rule-of-thumb prototype estimate. Validate before operational use.",
    )
