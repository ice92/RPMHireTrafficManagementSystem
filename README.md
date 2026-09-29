# Traffic Management System

A GIS-oriented RPM Hire prototype for reviewing planned road projects, traffic-control equipment, and indicative impacts on traffic and public transport. The initial sample map is centered on Melbourne.

> Impact results are illustrative scenario comparisons only. They are not validated traffic forecasts, operational instructions, or safety advice.

## Stack

- Frontend: React, TypeScript, Vite, MapLibre GL JS
- API: Python, FastAPI, Pydantic
- Map: OpenStreetMap raster tiles; internet access is required for the basemap
- Storage: in-memory sample data for the prototype; PostGIS is a planned integration

## Requirements

- Node.js 20+ and npm
- Python 3.9+

## Run locally

1. In the project root, install frontend packages with `npm install`.
2. Start the API in a separate terminal: create/activate a Python virtual environment, install `backend/requirements.txt`, then run `uvicorn app.main:app --reload --app-dir backend`.
3. Start the frontend from the project root with `npm run dev` and open the local URL Vite prints.

The frontend expects the API at `http://localhost:8000`. Set `VITE_API_URL` to override it. FastAPI's interactive API docs are available at `/docs` while the backend runs.

## Prototype capabilities

- View sample work zones as radius-based areas and traffic-control assets on a Melbourne map. Each project can set its own zone radius (25–5,000 m).
- View a concept pedestrian diversion around the selected impact radius, with a rough extra-distance estimate. This is not sidewalk/accessibility-validated navigation; verify before use.
- See anonymized sample controller posts at each project's north, east, south, and west gates with manual fatigue-check-in indicators.
- Drag gatepoint markers to match actual site entrances; moved positions are retained in the API's in-memory store.
- Request pedestrian detours from an OpenStreetMap foot-routing service via a waypoint around the work zone. If routing is unavailable, the map clearly labels the illustrative fallback. Set `VITE_FOOT_ROUTING_URL` to use a different OSRM-compatible foot router.
- Log a site hazard or emergency against a project gatepoint. Alerts are stored only in the prototype's in-memory log; no worker, site-management, or emergency-services dispatch is connected.
- Gate fatigue indicators are sample/manual check-ins, not sensor-based fatigue monitoring. For immediate danger, follow the site's emergency plan and call 000 in Australia; the prototype alert form does not dispatch help.
- Drag barriers, signs, and speed-limit controls from the map palette onto the map to place new assets at exact coordinates.
- Add gate controllers to a selected project and add end-of-queue sensors or variable speed-limit equipment from the map palette or equipment form.
- Add controller locations through the gate-team form and reposition existing controllers by dragging their map markers; positions remain in the backend's in-memory store while it runs.
- Filter and inspect projects and equipment.
- Configure an indicative scenario and compare modeled traffic and transit effects.
- Create projects/assets in the API's in-memory store (data resets when the API restarts).

## Impact model and limitations

The baseline service uses transparent rule-of-thumb factors based on lane closures, duration, and equipment. It does not ingest live traffic, transit schedules, road-network capacity, or calibrated demand. It should be replaced and validated against authoritative network, traffic, and public-transport data before operational use.

## Next steps

- Connect an authorized PostGIS database and replace in-memory repositories.
- Add GeoJSON import/export and a project editing workflow.
- Integrate validated road-network, traffic-count, and public-transport datasets; verify pedestrian detours against site closures and accessibility requirements.
- Add model calibration, audit history, and role-based access control.
