from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_seed_projects_and_assets_are_available() -> None:
    assert len(client.get("/projects").json()) >= 3
    assert len(client.get("/assets").json()) >= 4




def test_estimate_returns_clear_prototype_caveat() -> None:
    response = client.post(
        "/scenarios/estimate",
        json={
            "project_id": "prj-01",
            "lanes_closed": 1,
            "duration_days": 4,
            "speed_limit_kmh": 60,
        },
    )
    assert response.status_code == 200
    result = response.json()
    assert result["estimated_delay_minutes"] > 0
    assert "prototype" in result["note"].lower()


def test_estimate_rejects_unknown_project() -> None:
    response = client.post(
        "/scenarios/estimate",
        json={
            "project_id": "missing",
            "lanes_closed": 1,
            "duration_days": 4,
            "speed_limit_kmh": 60,
        },
    )
    assert response.status_code == 404


def test_each_project_has_four_gate_controller_checkins() -> None:
    response = client.get("/gate-controllers", params={"project_id": "prj-01"})
    assert response.status_code == 200
    controllers = response.json()
    assert len(controllers) == 4
    assert {controller["gatepoint"] for controller in controllers} == {
        "North gate", "East gate", "South gate", "West gate"
    }
    assert all(controller["fatigue_level"] in {"Clear", "Check-in due", "Relief recommended"} for controller in controllers)


def test_site_alert_is_logged_for_a_valid_gatepoint() -> None:
    response = client.post(
        "/alerts",
        json={
            "project_id": "prj-01",
            "gatepoint_id": "prj-01-north",
            "alert_type": "Hazard",
            "details": "Debris reported by north gate",
        },
    )
    assert response.status_code == 201
    alert = response.json()
    assert alert["alert_type"] == "Hazard"
    assert "no external dispatch" in alert["status"].lower()


def test_gatepoint_position_can_be_adjusted_and_read_back() -> None:
    original = client.get("/gate-controllers", params={"project_id": "prj-01"}).json()[0]["coordinates"]
    adjusted = [144.9301, -37.8123]
    response = client.patch(
        "/gate-controllers/prj-01-north/position",
        json={"coordinates": adjusted},
    )
    assert response.status_code == 200
    assert response.json()["coordinates"] == adjusted
    assert client.get("/gate-controllers", params={"project_id": "prj-01"}).json()[0]["coordinates"] == adjusted
    client.patch("/gate-controllers/prj-01-north/position", json={"coordinates": original})


def test_new_gate_controller_can_be_added_to_project() -> None:
    response = client.post(
        "/gate-controllers",
        json={
            "project_id": "prj-01",
            "gatepoint": "West compound entrance",
            "controller_label": "TC-99",
            "fatigue_level": "Clear",
            "coordinates": [144.924, -37.806],
        },
    )
    assert response.status_code == 201
    controller = response.json()
    assert controller["gatepoint"] == "West compound entrance"
    assert controller in client.get("/gate-controllers", params={"project_id": "prj-01"}).json()


def test_end_of_queue_sensor_asset_can_be_created() -> None:
    response = client.post(
        "/assets",
        json={
            "project_id": "prj-01",
            "type": "queue_sensor",
            "label": "Dynon west approach queue sensor",
            "value": "Detection range 250 m",
            "coordinates": [144.921, -37.808],
        },
    )
    assert response.status_code == 201
    assert response.json()["type"] == "queue_sensor"


def test_variable_speed_limit_asset_can_be_created() -> None:
    response = client.post(
        "/assets",
        json={
            "project_id": "prj-01",
            "type": "speed_limit",
            "label": "Temporary variable limit",
            "value": "40 km/h",
            "coordinates": [144.922, -37.808],
        },
    )
    assert response.status_code == 201
    assert response.json()["value"] == "40 km/h"
