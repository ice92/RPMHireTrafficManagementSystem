import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { FeatureCollection, LineString, Polygon } from 'geojson'
import { api } from './api'
import type { AssetType, FatigueLevel, GateController, ImpactEstimate, Project, SiteAlert, SiteAlertType, TrafficAsset } from './types'

const demoProjects: Project[] = [
  { id: 'prj-01', name: 'CityLink resurfacing', location: 'West Melbourne · Dynon Rd', status: 'Active', lanes_closed: 1, duration_days: 4, radius_meters: 350, coordinates: [144.926, -37.807] },
  { id: 'prj-02', name: 'Tram stop accessibility', location: 'Carlton · Swanston St', status: 'Planned', lanes_closed: 1, duration_days: 12, radius_meters: 220, coordinates: [144.965, -37.801] },
  { id: 'prj-03', name: 'Water main renewal', location: 'Southbank · City Rd', status: 'Active', lanes_closed: 2, duration_days: 7, radius_meters: 280, coordinates: [144.961, -37.829] },
]
const demoAssets: TrafficAsset[] = [
  { id: 'ast-01', project_id: 'prj-01', type: 'barrier', label: 'Concrete barrier', coordinates: [144.923, -37.805] },
  { id: 'ast-02', project_id: 'prj-01', type: 'sign', label: 'Road works ahead', coordinates: [144.931, -37.809] },
  { id: 'ast-03', project_id: 'prj-02', type: 'speed_limit', label: 'Temporary speed limit', value: '40 km/h', coordinates: [144.969, -37.799] },
  { id: 'ast-04', project_id: 'prj-03', type: 'barrier', label: 'Lane closure barrier', coordinates: [144.957, -37.827] },
]

const initialEstimate: ImpactEstimate = {
  estimated_delay_minutes: 6,
  traffic_impact: 'Moderate',
  transit_impact: 'Low',
  affected_routes: ['Route 96', 'Route 109'],
  note: 'Illustrative baseline only — not a validated forecast.',
}
const FOOT_ROUTING_URL = import.meta.env.VITE_FOOT_ROUTING_URL
  ?? 'https://routing.openstreetmap.de/routed-foot/route/v1/driving'

function assetSymbol(type: AssetType) {
  return type === 'barrier' ? '▰' : type === 'sign' ? '!' : type === 'speed_limit' ? '40' : 'Q'
}

function workZoneFeatures(projects: Project[]): FeatureCollection<Polygon> {
  const earthRadiusMeters = 6_371_000
  return {
    type: 'FeatureCollection',
    features: projects.map((project) => {
      const [longitude, latitude] = project.coordinates
      const angularRadius = project.radius_meters / earthRadiusMeters
      const latitudeRadians = latitude * Math.PI / 180
      const ring = Array.from({ length: 65 }, (_, index) => {
        const angle = index * 2 * Math.PI / 64
        const pointLatitude = latitudeRadians + angularRadius * Math.sin(angle)
        const pointLongitude = longitude * Math.PI / 180 + angularRadius * Math.cos(angle) / Math.cos(latitudeRadians)
        return [pointLongitude * 180 / Math.PI, pointLatitude * 180 / Math.PI] as [number, number]
      })
      ring[ring.length - 1] = ring[0]
      return {
        type: 'Feature',
        properties: { id: project.id },
        geometry: { type: 'Polygon', coordinates: [ring] },
      }
    }),
  }
}

function pedestrianRouteFeatures(project: Project | undefined, routedCoordinates?: [number, number][]): FeatureCollection<LineString> {
  if (!project) return { type: 'FeatureCollection', features: [] }
  const [longitude, latitude] = project.coordinates
  const metersPerDegreeLatitude = 111_320
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(latitude * Math.PI / 180)
  const radius = project.radius_meters
  const approachDistance = radius + 250
  const detourRadius = radius + 60
  const reroute: [number, number][] = [[longitude - approachDistance / metersPerDegreeLongitude, latitude]]

  for (let step = 0; step <= 24; step += 1) {
    const angle = Math.PI - step * Math.PI / 24
    reroute.push([
      longitude + detourRadius * Math.cos(angle) / metersPerDegreeLongitude,
      latitude + detourRadius * Math.sin(angle) / metersPerDegreeLatitude,
    ])
  }
  reroute.push([longitude + approachDistance / metersPerDegreeLongitude, latitude])

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { route: 'impacted' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [longitude - approachDistance / metersPerDegreeLongitude, latitude],
            [longitude, latitude],
            [longitude + approachDistance / metersPerDegreeLongitude, latitude],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { route: 'pedestrian-reroute' },
        geometry: { type: 'LineString', coordinates: routedCoordinates?.length ? routedCoordinates : reroute },
      },
    ],
  }
}

function estimatedExtraWalkMeters(project: Project | undefined, routeCoordinates?: [number, number][]): number {
  if (!project) return 0
  if (routeCoordinates && routeCoordinates.length > 1) {
    const earthRadiusMeters = 6_371_000
    const routeDistance = routeCoordinates.slice(1).reduce((distance, coordinate, index) => {
      const previous = routeCoordinates[index]
      const latitudeDelta = (coordinate[1] - previous[1]) * Math.PI / 180
      const longitudeDelta = (coordinate[0] - previous[0]) * Math.PI / 180
      const startLatitude = previous[1] * Math.PI / 180
      const endLatitude = coordinate[1] * Math.PI / 180
      const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2
      return distance + 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
    }, 0)
    const approachMeters = project.radius_meters + 250
    const directDistance = 2 * approachMeters
    return Math.max(0, Math.round((routeDistance - directDistance) / 10) * 10)
  }
  const radius = project.radius_meters
  const directMeters = 2 * (radius + 250)
  const detourMeters = Math.PI * (radius + 60) + 380
  return Math.max(0, Math.round((detourMeters - directMeters) / 10) * 10)
}

function localGateControllers(projects: Project[], startingProjectIndex = 0): GateController[] {
  const gates = [
    { name: 'North gate', eastWest: 0, northSouth: 1 },
    { name: 'East gate', eastWest: 1, northSouth: 0 },
    { name: 'South gate', eastWest: 0, northSouth: -1 },
    { name: 'West gate', eastWest: -1, northSouth: 0 },
  ]
  const fatigueLevels: FatigueLevel[] = ['Clear', 'Check-in due', 'Clear', 'Relief recommended']
  const checkInTimes = ['6 min ago', '28 min ago', '11 min ago', '34 min ago']
  return projects.flatMap((project, projectIndex) => gates.map((gate, gateIndex) => {
    const latitudeScale = 111_320
    const longitudeScale = latitudeScale * Math.cos(project.coordinates[1] * Math.PI / 180)
    const offset = project.radius_meters + 25
    const globalIndex = (startingProjectIndex + projectIndex) * gates.length + gateIndex
    return {
      id: `${project.id}-${gate.name.split(' ')[0].toLowerCase()}`,
      project_id: project.id,
      gatepoint: gate.name,
      controller_label: `TC-${String(globalIndex + 1).padStart(2, '0')}`,
      fatigue_level: fatigueLevels[((startingProjectIndex + projectIndex) + gateIndex) % fatigueLevels.length],
      last_check_in: checkInTimes[gateIndex],
      coordinates: [
        project.coordinates[0] + gate.eastWest * offset / longitudeScale,
        project.coordinates[1] + gate.northSouth * offset / latitudeScale,
      ] as [number, number],
    }
  }))
}

function estimateLocally(project: Project | undefined, lanes: number, days: number, speed: number): ImpactEstimate {
  const delay = Math.max(2, Math.round(2 + lanes * 4 + Math.min(days, 21) * 0.45 + (80 - speed) * 0.08))
  const level = delay >= 13 ? 'High' : delay >= 7 ? 'Moderate' : 'Low'
  const transit = project?.name.toLowerCase().includes('tram') || project?.name.toLowerCase().includes('city') ? 'Moderate' : level === 'High' ? 'Moderate' : 'Low'
  return {
    estimated_delay_minutes: delay,
    traffic_impact: level,
    transit_impact: transit,
    affected_routes: transit === 'Moderate' ? ['Route 96', 'Route 109'] : ['Route 12'],
    note: 'Rule-of-thumb prototype estimate. Validate before operational use.',
  }
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const [projects, setProjects] = useState(demoProjects)
  const [assets, setAssets] = useState(demoAssets)
  const [gateControllers, setGateControllers] = useState(() => localGateControllers(demoProjects))
  const [pedestrianRouteCoordinates, setPedestrianRouteCoordinates] = useState<[number, number][] | null>(null)
  const [pedestrianRouteStatus, setPedestrianRouteStatus] = useState<'loading' | 'openstreetmap' | 'concept'>('loading')
  const [selectedId, setSelectedId] = useState('prj-01')
  const [selectedGatepointId, setSelectedGatepointId] = useState('')
  const [showProjects, setShowProjects] = useState(true)
  const [showAssets, setShowAssets] = useState(true)
  const [showGateControllers, setShowGateControllers] = useState(true)
  const [showPedestrianReroute, setShowPedestrianReroute] = useState(true)
  const [lanes, setLanes] = useState(1)
  const [days, setDays] = useState(4)
  const [speed, setSpeed] = useState(60)
  const [estimate, setEstimate] = useState(initialEstimate)
  const [apiStatus, setApiStatus] = useState<'connected' | 'sample'>('sample')
  const [modal, setModal] = useState<'project' | 'asset' | 'gate-controller' | null>(null)
  const [assetDraftType, setAssetDraftType] = useState<AssetType>('barrier')
  const [pendingAssetCoordinates, setPendingAssetCoordinates] = useState<[number, number] | null>(null)
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertType, setAlertType] = useState<SiteAlertType>('Hazard')
  const [siteAlerts, setSiteAlerts] = useState<SiteAlert[]>([])
  const [toast, setToast] = useState('')

  const selectedProject = projects.find((project) => project.id === selectedId) ?? projects[0]
  const currentPedestrianFeatures = useMemo(
    () => pedestrianRouteFeatures(selectedProject, pedestrianRouteCoordinates ?? undefined),
    [selectedProject, pedestrianRouteCoordinates],
  )
  const pedestrianFeaturesRef = useRef(currentPedestrianFeatures)
  pedestrianFeaturesRef.current = currentPedestrianFeatures
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const selectedControllers = gateControllers.filter((controller) => controller.project_id === selectedProject?.id)
  const scenario = useMemo(() => ({
    project_id: selectedProject?.id ?? '',
    lanes_closed: lanes,
    duration_days: days,
    speed_limit_kmh: speed,
  }), [selectedProject?.id, lanes, days, speed])

  useEffect(() => {
    let active = true
    Promise.all([api.projects(), api.assets(), api.gateControllers(), api.alerts()]).then(([loadedProjects, loadedAssets, loadedControllers, loadedAlerts]) => {
      if (!active || !loadedProjects.length) return
      setProjects(loadedProjects)
      setAssets(loadedAssets)
      setGateControllers(loadedControllers)
      setSiteAlerts(loadedAlerts)
      setSelectedId(loadedProjects[0].id)
      setApiStatus('connected')
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      center: [144.958, -37.814],
      zoom: 12.4,
      pitch: 0,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.65, 'raster-contrast': 0.08 } }],
      },
    })
    map.on('load', () => {
      map.addSource('work-zones', { type: 'geojson', data: workZoneFeatures(projectsRef.current) })
      map.addLayer({
        id: 'work-zone-fill',
        type: 'fill',
        source: 'work-zones',
        paint: {
          'fill-color': ['case', ['==', ['get', 'id'], selectedId], '#d99048', '#e2a45d'],
          'fill-opacity': ['case', ['==', ['get', 'id'], selectedId], 0.24, 0.13],
        },
      })
      map.addLayer({
        id: 'work-zone-outline',
        type: 'line',
        source: 'work-zones',
        paint: {
          'line-color': ['case', ['==', ['get', 'id'], selectedId], '#bc7130', '#c38a4b'],
          'line-width': ['case', ['==', ['get', 'id'], selectedId], 2.5, 1.5],
          'line-dasharray': [2, 1.5],
        },
      })
      map.addSource('pedestrian-routes', { type: 'geojson', data: pedestrianFeaturesRef.current })
      map.addLayer({
        id: 'impacted-walk-route',
        type: 'line',
        source: 'pedestrian-routes',
        filter: ['==', ['get', 'route'], 'impacted'],
        paint: { 'line-color': '#c45e56', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
      })
      map.addLayer({
        id: 'pedestrian-reroute',
        type: 'line',
        source: 'pedestrian-routes',
        filter: ['==', ['get', 'route'], 'pedestrian-reroute'],
        paint: { 'line-color': '#16866e', 'line-width': 4, 'line-opacity': 0.95 },
      })
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapContainer.current)
    return () => {
      resizeObserver.disconnect()
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!selectedProject) return
    const abortController = new AbortController()
    const [longitude, latitude] = selectedProject.coordinates
    const metersPerDegreeLatitude = 111_320
    const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(latitude * Math.PI / 180)
    const approachDistance = selectedProject.radius_meters + 250
    const waypointDistance = selectedProject.radius_meters + 180
    const start: [number, number] = [longitude - approachDistance / metersPerDegreeLongitude, latitude]
    const northWaypoint: [number, number] = [longitude, latitude + waypointDistance / metersPerDegreeLatitude]
    const end: [number, number] = [longitude + approachDistance / metersPerDegreeLongitude, latitude]
    const coordinates = [start, northWaypoint, end].map(([lon, lat]) => `${lon},${lat}`).join(';')

    setPedestrianRouteCoordinates(null)
    setPedestrianRouteStatus('loading')
    fetch(`${FOOT_ROUTING_URL}/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Foot router request failed')
        return response.json() as Promise<{ code?: string; routes?: { geometry?: { coordinates?: number[][] } }[] }>
      })
      .then((result) => {
        const route = result.code === 'Ok' ? result.routes?.[0]?.geometry?.coordinates : undefined
        if (!route || route.length < 2) throw new Error('No pedestrian path returned')
        setPedestrianRouteCoordinates(route.map(([lon, lat]) => [lon, lat] as [number, number]))
        setPedestrianRouteStatus('openstreetmap')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setPedestrianRouteCoordinates(null)
        setPedestrianRouteStatus('concept')
      })
    return () => abortController.abort()
  }, [selectedProject])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const zoneSource = map.getSource('work-zones') as GeoJSONSource | undefined
    zoneSource?.setData(workZoneFeatures(projects))
    const routeSource = map.getSource('pedestrian-routes') as GeoJSONSource | undefined
    routeSource?.setData(currentPedestrianFeatures)
    if (map.getLayer('work-zone-fill')) {
      const visibility = showProjects ? 'visible' : 'none'
      map.setLayoutProperty('work-zone-fill', 'visibility', visibility)
      map.setLayoutProperty('work-zone-outline', 'visibility', visibility)
      map.setPaintProperty('work-zone-fill', 'fill-color', ['case', ['==', ['get', 'id'], selectedId], '#d99048', '#e2a45d'])
      map.setPaintProperty('work-zone-fill', 'fill-opacity', ['case', ['==', ['get', 'id'], selectedId], 0.24, 0.13])
      map.setPaintProperty('work-zone-outline', 'line-color', ['case', ['==', ['get', 'id'], selectedId], '#bc7130', '#c38a4b'])
      map.setPaintProperty('work-zone-outline', 'line-width', ['case', ['==', ['get', 'id'], selectedId], 2.5, 1.5])
    }
    if (map.getLayer('impacted-walk-route')) {
      const visibility = showPedestrianReroute ? 'visible' : 'none'
      map.setLayoutProperty('impacted-walk-route', 'visibility', visibility)
      map.setLayoutProperty('pedestrian-reroute', 'visibility', visibility)
    }
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []
    if (showProjects) {
      projects.forEach((project) => {
        const element = document.createElement('button')
        element.className = `map-marker project-marker${project.id === selectedId ? ' selected' : ''}`
        element.type = 'button'
        element.setAttribute('aria-label', `Select ${project.name}`)
        element.innerHTML = '<span></span>'
        element.onclick = () => {
          setSelectedId(project.id)
          setSelectedGatepointId('')
          setLanes(project.lanes_closed)
          setDays(project.duration_days)
        }
        markersRef.current.push(new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(project.coordinates).addTo(map))
      })
    }
    if (showGateControllers) gateControllers.forEach((controller) => {
      const element = document.createElement('button')
      element.className = `map-marker gatepoint-marker fatigue-${controller.fatigue_level.toLowerCase().replaceAll(' ', '-')}${controller.id === selectedGatepointId ? ' selected' : ''}`
      element.type = 'button'
      element.setAttribute('aria-label', `${controller.gatepoint}, controller ${controller.controller_label}, fatigue check ${controller.fatigue_level}`)
      element.title = `Drag to position ${controller.gatepoint} at its actual entrance`
      element.textContent = 'T'
      element.onclick = () => {
        setSelectedId(controller.project_id)
        setSelectedGatepointId(controller.id)
        const project = projects.find((item) => item.id === controller.project_id)
        if (project) {
          setLanes(project.lanes_closed)
          setDays(project.duration_days)
          map.flyTo({ center: controller.coordinates, zoom: 15, duration: 700 })
        }
      }
        const marker = new maplibregl.Marker({ element, anchor: 'center', draggable: true }).setLngLat(controller.coordinates).addTo(map)
        marker.on('dragend', () => {
          const position = marker.getLngLat()
          const coordinates: [number, number] = [position.lng, position.lat]
          setGateControllers((current) => current.map((item) => item.id === controller.id ? { ...item, coordinates } : item))
          if (apiStatus === 'connected') {
            api.updateGatePosition(controller.id, coordinates).catch(() => setToast('Gatepoint moved in this session, but the API did not save the new position.'))
          }
        })
        markersRef.current.push(marker)
    })
    if (showAssets) {
      assets.forEach((asset) => {
        const element = document.createElement('div')
        element.className = `map-marker asset-marker ${asset.type.replace('_', '-')}`
        element.setAttribute('aria-label', asset.label)
        element.textContent = assetSymbol(asset.type)
        markersRef.current.push(new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(asset.coordinates).addTo(map))
      })
    }
  }, [projects, assets, gateControllers, selectedId, selectedGatepointId, selectedProject, currentPedestrianFeatures, showProjects, showAssets, showGateControllers, showPedestrianReroute, apiStatus])

  useEffect(() => {
    const localEstimate = estimateLocally(selectedProject, lanes, days, speed)
    setEstimate(localEstimate)
    api.estimate(scenario).then(setEstimate).catch(() => undefined)
  }, [scenario, selectedProject, lanes, days, speed])

  function selectProject(project: Project) {
    setSelectedId(project.id)
    setSelectedGatepointId('')
    setLanes(project.lanes_closed)
    setDays(project.duration_days)
    mapRef.current?.flyTo({ center: project.coordinates, zoom: 14, duration: 850 })
  }

  function openSiteAlert(gatepointId = '') {
    setSelectedGatepointId(gatepointId)
    setAlertType('Hazard')
    setAlertOpen(true)
  }

  async function submitSiteAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      project_id: selectedProject?.id ?? '',
      gatepoint_id: String(form.get('gatepoint_id')),
      alert_type: form.get('alert_type') as SiteAlertType,
      details: String(form.get('details')),
    }
    try {
      const alert = apiStatus === 'connected'
        ? await api.createAlert(payload)
        : { ...payload, id: `local-${Date.now()}`, created_at: new Date().toISOString(), status: 'Recorded in this browser only — no external dispatch' }
      setSiteAlerts((current) => [alert, ...current])
      setAlertOpen(false)
      setToast(`${alert.alert_type} logged locally; no external dispatch is configured.`)
    } catch {
      setToast('Could not log alert. Check the API connection and retry.')
    }
  }

  function handleAssetDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/x-traffic-asset') as AssetType
    const map = mapRef.current
    const container = mapContainer.current
    if (!map || !container || !['barrier', 'sign', 'speed_limit', 'queue_sensor'].includes(type)) return

    const bounds = container.getBoundingClientRect()
    const point: [number, number] = [event.clientX - bounds.left, event.clientY - bounds.top]
    setAssetDraftType(type)
    setPendingAssetCoordinates(map.unproject(point).toArray() as [number, number])
    setModal('asset')
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const project: Omit<Project, 'id'> = {
      name: String(data.get('name')),
      location: String(data.get('location')),
      status: 'Planned',
      lanes_closed: Number(data.get('lanes')),
      duration_days: Number(data.get('days')),
      radius_meters: Number(data.get('radius_meters')),
      coordinates: [Number(data.get('longitude')), Number(data.get('latitude'))],
    }
    try {
      const saved = apiStatus === 'connected' ? await api.createProject(project) : { ...project, id: `local-${Date.now()}` }
      setProjects((current) => [...current, saved])
      if (apiStatus === 'connected') {
        setGateControllers(await api.gateControllers())
      } else {
        setGateControllers((current) => [...current, ...localGateControllers([saved], projects.length)])
      }
      setSelectedId(saved.id)
      setToast('Project added to the map')
      setModal(null)
    } catch {
      setToast('Could not save project — check the API connection')
    }
  }

  async function saveAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const asset: Omit<TrafficAsset, 'id'> = {
      project_id: selectedProject?.id ?? '',
      type: data.get('type') as AssetType,
      label: String(data.get('label')),
      value: String(data.get('type')) === 'speed_limit'
        ? `${Number(data.get('speed_limit_kmh'))} km/h`
        : String(data.get('value') ?? ''),
      coordinates: [Number(data.get('longitude')), Number(data.get('latitude'))],
    }
    try {
      const saved = apiStatus === 'connected' ? await api.createAsset(asset) : { ...asset, id: `local-${Date.now()}` }
      setAssets((current) => [...current, saved])
      setPendingAssetCoordinates(null)
      setToast('Control equipment added to the map')
      setModal(null)
    } catch {
      setToast('Could not save equipment — check the API connection')
    }
  }

  async function saveGateController(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const controller = {
      project_id: selectedProject?.id ?? '',
      gatepoint: String(data.get('gatepoint')),
      controller_label: String(data.get('controller_label')),
      fatigue_level: data.get('fatigue_level') as FatigueLevel,
      last_check_in: 'Just now',
      coordinates: [Number(data.get('longitude')), Number(data.get('latitude'))] as [number, number],
    }
    try {
      const saved = apiStatus === 'connected'
        ? await api.createGateController(controller)
        : { ...controller, id: `local-${Date.now()}` }
      setGateControllers((current) => [...current, saved])
      setSelectedGatepointId(saved.id)
      setModal(null)
      setToast('Gate controller added to the map')
    } catch {
      setToast('Could not add controller — check project and gatepoint details')
    }
  }

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-mark" aria-label="RPM Hire"><span className="brand-glyph">RPM</span></div>
        <button className="rail-button active" aria-label="Operations map" title="Operations map"><span>⌖</span></button>
        <button className="rail-button" aria-label="Projects" title="Projects" onClick={() => document.getElementById('project-list')?.scrollIntoView({ behavior: 'smooth' })}><span>▤</span></button>
        <button className="rail-button" aria-label="Analytics" title="Analytics"><span>▥</span></button>
        <div className="rail-bottom"><button className="rail-button" aria-label="Settings" title="Settings"><span>⚙</span></button><div className="avatar">IM</div></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left"><div className="top-brand" aria-label="RPM Hire Traffic Operations"><span className="top-brand-symbol">RPM</span><span className="top-brand-copy">HIRE<small>TRAFFIC OPERATIONS</small></span></div><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Network overview</strong></div></div>
          <div className="topbar-right"><span className="live-status"><i />{apiStatus === 'connected' ? 'API connected' : 'Sample data'}</span><button className="icon-button" aria-label="Notifications">♧<i className="notification-dot" /></button><div className="top-avatar">IM</div></div>
        </header>

        <section className="page-heading">
          <div><div className="eyebrow"><span className="eyebrow-dot" /> MONDAY, 29 SEPTEMBER 2026 <span className="heading-divider">/</span> MELBOURNE, VIC</div><h1>Traffic operations</h1><p>See what's changing across your network today.</p></div>
          <div className="heading-actions"><button className="button button-alert" onClick={() => openSiteAlert()}><span>⚑</span> Site alert{siteAlerts.length > 0 ? ` · ${siteAlerts.length}` : ''}</button><button className="button button-secondary" onClick={() => { setPendingAssetCoordinates(null); setAssetDraftType('barrier'); setModal('asset') }}><span>＋</span> Add equipment</button><button className="button button-primary" onClick={() => setModal('project')}><span>＋</span> New project</button></div>
        </section>

        <section className="metric-grid" aria-label="Network summary">
          <article className="metric-card"><div className="metric-top"><span>ACTIVE PROJECTS</span><span className="metric-icon amber">◫</span></div><div className="metric-value">{projects.filter((project) => project.status === 'Active').length}<span className="metric-unit"> projects</span></div><div className="metric-foot"><span className="status-pill status-active">● Live</span><span>across the network</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>CONTROL ASSETS</span><span className="metric-icon blue">⌑</span></div><div className="metric-value">{assets.length}<span className="metric-unit"> deployed</span></div><div className="metric-foot"><span>{assets.filter((asset) => asset.type === 'barrier').length} barriers</span><span>·</span><span>{assets.filter((asset) => asset.type === 'sign' || asset.type === 'speed_limit').length} signs & limits</span><span>·</span><span>{assets.filter((asset) => asset.type === 'queue_sensor').length} queue sensors</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>NETWORK CONDITIONS</span><span className="metric-icon green">↗</span></div><div className="metric-value">Mostly clear<span className="metric-unit"> today</span></div><div className="metric-foot"><span className="trend-line">↘ 8%</span><span>delay vs. last Monday</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>TRANSIT ROUTES</span><span className="metric-icon violet">↔</span></div><div className="metric-value">{new Set(estimate.affected_routes).size}<span className="metric-unit"> in scenario</span></div><div className="metric-foot"><span>{estimate.transit_impact} indicative impact</span></div></article>
        </section>

        <section className="content-grid">
          <div className="map-card">
            <div className="map-toolbar"><div><h2>Network map</h2><span className="map-subtitle">Greater Melbourne · Live project overview</span></div><button className="map-filter" aria-label="Map layers">☷ <span>Layers</span></button></div>
            <div className="map-stage" onDragOver={(event) => event.preventDefault()} onDrop={handleAssetDrop}>
              <div ref={mapContainer} className="map-canvas" aria-label="Map of traffic projects and traffic control equipment in Melbourne" />
              <div className="map-search"><span>⌕</span><input aria-label="Search map" placeholder="Search location, project or asset..." /><kbd>⌘ K</kbd></div>
              <div className="map-layers"><label><input type="checkbox" checked={showProjects} onChange={(event) => setShowProjects(event.target.checked)} /><span className="legend-dot project-dot" /> Work zones <b>{projects.length}</b></label><label><input type="checkbox" checked={showAssets} onChange={(event) => setShowAssets(event.target.checked)} /><span className="legend-dot asset-dot" /> Control assets <b>{assets.length}</b></label><label><input type="checkbox" checked={showGateControllers} onChange={(event) => setShowGateControllers(event.target.checked)} /><span className="legend-gatepoint">T</span> Gate controllers <b>{gateControllers.length}</b></label><label><input type="checkbox" checked={showPedestrianReroute} onChange={(event) => setShowPedestrianReroute(event.target.checked)} /><span className="legend-route" /> Pedestrian reroute</label><div className="map-legend"><span><i className="legend-barrier">▰</i> Barrier</span><span><i className="legend-sign">!</i> Sign</span><span><i className="legend-speed">40</i> Speed limit</span><span><i className="legend-queue">Q</i> Queue sensor</span><span><i className="legend-impacted-route" /> Impacted path</span></div></div>
              <div className="equipment-palette" aria-label="Drag equipment onto the map">
                <span className="palette-label">DRAG ONTO MAP</span>
                {(['barrier', 'sign', 'speed_limit', 'queue_sensor'] as const).map((type) => <button key={type} type="button" className={`palette-item palette-${type.replace('_', '-')}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-traffic-asset', type); event.dataTransfer.effectAllowed = 'copy' }} title={`Drag ${type === 'queue_sensor' ? 'end-of-queue sensor' : type.replace('_', ' ')} onto the map`}><i>{assetSymbol(type)}</i><span>{type === 'speed_limit' ? 'Speed limit' : type === 'queue_sensor' ? 'Queue sensor' : type === 'barrier' ? 'Barrier' : 'Sign'}</span></button>)}
              </div>
              <div className="map-scale"><span /> 500 m</div>
              <div className="map-attribution">© OpenStreetMap contributors</div>
            </div>
            <div className="map-footer"><span><i className="footer-green-dot" /> Network updated 4 min ago</span><button onClick={() => mapRef.current?.flyTo({ center: [144.958, -37.814], zoom: 12.4 })}>⌖ <span>Reset view</span></button></div>
          </div>

          <aside className="inspector">
            <div className="inspector-title"><div><span className="panel-kicker">PLANNING WORKSPACE</span><h2>Impact scenario</h2></div><button className="more-button" aria-label="More scenario actions">···</button></div>
            <div className="selected-project"><div className="project-color" /><div className="selected-copy"><span>SELECTED PROJECT</span><strong>{selectedProject?.name ?? 'No project selected'}</strong><small>{selectedProject?.location}</small></div><button className="chevron-button" aria-label="Choose project">⌄</button></div>
            <div className="pedestrian-detour"><div className="detour-title"><span className="detour-icon">↗</span><strong>Pedestrian reroute</strong><span className="detour-status">{pedestrianRouteStatus === 'openstreetmap' ? 'OSM WALK ROUTE' : pedestrianRouteStatus === 'loading' ? 'ROUTING…' : 'CONCEPT FALLBACK'}</span></div><p>{pedestrianRouteStatus === 'openstreetmap' ? 'Route follows OpenStreetMap pedestrian paths around the work zone.' : 'Routing unavailable; showing a conceptual detour preview.'}</p><div className="detour-distance"><span>Estimated extra walk</span><strong>+{estimatedExtraWalkMeters(selectedProject, pedestrianRouteCoordinates ?? undefined)} m</strong></div><small>OSM path data may be incomplete and does not include verified worksite closures or accessible-surface checks. Confirm the route on site.</small></div>
            <section className="gate-team"><div className="gate-team-heading"><div><h3>Gatepoint controllers</h3><span>{selectedControllers.length} posts around this zone</span></div><button type="button" className="add-gate-button" onClick={() => setModal('gate-controller')}>＋ Add controller</button></div>
              <p className="fatigue-disclaimer">Drag each gate marker on the map to match its actual entrance. Positions are saved to the API when connected. Fatigue statuses are demo/manual check-ins, not sensor monitoring.</p>
              <div className="gate-controller-list">{selectedControllers.map((controller) => <div className="gate-controller-row" key={controller.id}><span className={`fatigue-indicator fatigue-${controller.fatigue_level.toLowerCase().replaceAll(' ', '-')}`} title={controller.fatigue_level} /><div className="gate-controller-copy"><strong>{controller.gatepoint}</strong><span>{controller.controller_label} · checked {controller.last_check_in}</span></div><span className={`fatigue-label fatigue-text-${controller.fatigue_level.toLowerCase().replaceAll(' ', '-')}`}>{controller.fatigue_level}</span><button type="button" className="gate-alert-button" onClick={() => openSiteAlert(controller.id)} aria-label={`Send alert for ${controller.gatepoint}`}>Alert</button></div>)}</div>{siteAlerts.length > 0 && <div className="recent-alert"><strong>Latest site alert</strong><span>{siteAlerts[0].alert_type} · {siteAlerts[0].details}</span></div>}</section>
              <div className="scenario-controls"><div className="control-heading"><h3>Adjust conditions</h3><span>Scenario inputs</span></div>
                <label className="range-control"><span><span>Lanes closed</span><strong>{lanes} lane{lanes === 1 ? '' : 's'}</strong></span><input type="range" min="0" max="3" value={lanes} onChange={(event) => setLanes(Number(event.target.value))} /><span className="range-caption"><small>No closure</small><small>3 lanes</small></span></label>
                <label className="range-control"><span><span>Work duration</span><strong>{days} days</strong></span><input type="range" min="1" max="21" value={days} onChange={(event) => setDays(Number(event.target.value))} /><span className="range-caption"><small>1 day</small><small>3 weeks</small></span></label>
                <label className="select-control"><span>Temporary speed limit</span><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="80">80 km/h</option><option value="60">60 km/h</option><option value="40">40 km/h</option></select></label>
              </div>
              <div className="impact-section"><div className="impact-heading"><h3>Indicative impact</h3><span className="estimate-badge">BASELINE MODEL</span></div>
                <div className="delay-result"><div><span>Estimated additional travel time</span><small>per affected trip · scenario estimate</small></div><strong>+{estimate.estimated_delay_minutes}<small> min</small></strong></div>
                <div className="impact-bars"><div className="impact-row"><span>Traffic</span><div className="impact-track"><i className={`impact-fill ${estimate.traffic_impact.toLowerCase()}`} /></div><b>{estimate.traffic_impact}</b></div><div className="impact-row"><span>Public transport</span><div className="impact-track"><i className={`impact-fill ${estimate.transit_impact.toLowerCase()}`} /></div><b>{estimate.transit_impact}</b></div></div>
                <div className="route-list"><span>AFFECTED ROUTES</span><div>{estimate.affected_routes.map((route) => <span className="route-chip" key={route}>{route}</span>)}</div></div></div>
              <div className="model-note"><span>ⓘ</span><p>{estimate.note}</p></div>
              <button className="compare-button" onClick={() => setToast('Scenario comparison is ready for review')}>Compare scenarios <span>→</span></button>
            </aside>
          </section>

        <section className="projects-section" id="project-list"><div className="section-heading"><div><h2>Projects on the network</h2><p>Review planned and active work zones</p></div><button className="text-button" onClick={() => setModal('project')}>View all projects <span>→</span></button></div><div className="project-table"><div className="table-head"><span>PROJECT</span><span>LOCATION</span><span>STATUS</span><span>LANES</span><span>DURATION</span><span /></div>{projects.map((project) => <button className={`project-row${selectedId === project.id ? ' row-selected' : ''}`} key={project.id} onClick={() => selectProject(project)}><span className="table-project"><i className="table-project-dot" /><strong>{project.name}</strong></span><span>{project.location}</span><span><i className={`status-dot ${project.status.toLowerCase()}`} />{project.status}</span><span>{project.lanes_closed} lane{project.lanes_closed === 1 ? '' : 's'}</span><span>{project.duration_days} days</span><span className="row-arrow">↗</span></button>)}</div></section>
      </main>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><form className="modal-card" onSubmit={modal === 'project' ? saveProject : modal === 'asset' ? saveAsset : saveGateController}><div className="modal-heading"><div><span className="panel-kicker">NETWORK PLANNING</span><h2>{modal === 'project' ? 'Add a project' : modal === 'asset' ? 'Add traffic equipment' : 'Add gate controller'}</h2></div><button type="button" className="more-button" aria-label="Close dialog" onClick={() => setModal(null)}>×</button></div>{modal === 'project' ? <><label>Project name<input required name="name" placeholder="e.g. Bridge maintenance" /></label><label>Location<input required name="location" placeholder="Suburb · Street" /></label><div className="form-row"><label>Lanes closed<input required name="lanes" type="number" min="0" max="3" defaultValue="1" /></label><label>Duration (days)<input required name="days" type="number" min="1" max="365" defaultValue="5" /></label></div>
<label>Work-zone radius (metres)<input required name="radius_meters" type="number" min="25" max="5000" step="25" defaultValue="250" /><small className="form-hint">The map circle represents the indicative area around the project.</small></label>
<div className="form-row"><label>Longitude<input required name="longitude" type="number" step="any" defaultValue="144.958" /></label><label>Latitude<input required name="latitude" type="number" step="any" defaultValue="-37.814" /></label></div>
<p className="form-hint">Coordinates use longitude, latitude order (WGS84 / EPSG:4326).</p>
</> : modal === 'asset' ? <>
<label>Equipment type<select name="type" value={assetDraftType} onChange={(event) => setAssetDraftType(event.target.value as AssetType)}><option value="barrier">Barrier</option><option value="sign">Road sign</option><option value="speed_limit">Variable speed limit</option><option value="queue_sensor">End-of-queue sensor</option></select></label>
<label>Label<input required name="label" placeholder={assetDraftType === 'queue_sensor' ? 'e.g. Western approach queue sensor' : 'e.g. Lane closed ahead'} /></label>
{assetDraftType === 'speed_limit' ? <label>Variable speed limit<select name="speed_limit_kmh" defaultValue="40"><option value="80">80 km/h</option><option value="60">60 km/h</option><option value="40">40 km/h</option><option value="20">20 km/h</option></select></label> : <label>Details<input name="value" placeholder={assetDraftType === 'queue_sensor' ? 'Detection range or device identifier' : 'Optional details'} /></label>}
<div className="form-row"><label>Longitude<input required name="longitude" type="number" step="any" defaultValue={pendingAssetCoordinates?.[0] ?? selectedProject?.coordinates[0] ?? 144.958} /></label><label>Latitude<input required name="latitude" type="number" step="any" defaultValue={pendingAssetCoordinates?.[1] ?? selectedProject?.coordinates[1] ?? -37.814} /></label></div>
<p className="form-hint">Coordinates use longitude, latitude order (WGS84 / EPSG:4326).</p>
</> : <>
<label>Gatepoint name<input required name="gatepoint" minLength={2} maxLength={80} placeholder="e.g. Western site entrance" /></label>
<label>Controller identifier<input required name="controller_label" minLength={2} maxLength={40} placeholder="e.g. TC-05" /></label>
<label>Initial fatigue check-in<select name="fatigue_level"><option value="Clear">Clear</option><option value="Check-in due">Check-in due</option><option value="Relief recommended">Relief recommended</option></select></label>
<div className="form-row"><label>Longitude<input required name="longitude" type="number" step="any" defaultValue={selectedProject?.coordinates[0] ?? 144.958} /></label><label>Latitude<input required name="latitude" type="number" step="any" defaultValue={selectedProject?.coordinates[1] ?? -37.814} /></label></div>
<p className="form-hint">Coordinates use longitude, latitude order. Controller fatigue status must come from appropriate, consent-based check-ins.</p>
</>}
<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" type="submit">{modal === 'project' ? 'Add project' : modal === 'asset' ? 'Add equipment' : 'Add controller'}</button></div></form></div>}
{toast && <div className="toast" role="status">✓ <span>{toast}</span></div>}
  {alertOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAlertOpen(false) }}><form className="modal-card alert-modal" onSubmit={submitSiteAlert}><div className="modal-heading"><div><span className="panel-kicker">SITE SAFETY REPORT</span><h2>Report an emergency or hazard</h2></div><button type="button" className="more-button" aria-label="Close alert form" onClick={() => setAlertOpen(false)}>×</button></div><label>Alert type<select name="alert_type" value={alertType} onChange={(event) => setAlertType(event.target.value as SiteAlertType)}><option value="Hazard">Hazard</option><option value="Emergency">Emergency</option></select></label><label>Project gatepoint<select name="gatepoint_id" defaultValue={selectedGatepointId || selectedControllers[0]?.id}>{selectedControllers.map((controller) => <option key={controller.id} value={controller.id}>{controller.gatepoint} · {controller.controller_label}</option>)}</select></label><label>What happened?<textarea name="details" required minLength={5} maxLength={500} rows={4} placeholder="Briefly describe the hazard or emergency for the site log." /></label><div className="alert-dispatch-note"><strong>Prototype alert log only</strong><span>This records the report in this app's in-memory log. It does not contact emergency services, site management, or workers. For immediate danger in Australia, follow the site emergency plan and call 000.</span></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setAlertOpen(false)}>Cancel</button><button className="button button-alert-submit" type="submit">Log {alertType.toLowerCase()}</button></div></form></div>}
    </div>
  )
}
