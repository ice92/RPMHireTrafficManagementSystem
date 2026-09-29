export type AssetType = 'barrier' | 'sign' | 'speed_limit' | 'queue_sensor'

export interface Project {
  id: string
  name: string
  location: string
  status: 'Active' | 'Planned' | 'Complete'
  lanes_closed: number
  duration_days: number
  radius_meters: number
  coordinates: [number, number]
}

export interface TrafficAsset {
  id: string
  project_id: string
  type: AssetType
  label: string
  value?: string
  coordinates: [number, number]
}

export type FatigueLevel = 'Clear' | 'Check-in due' | 'Relief recommended'
export type SiteAlertType = 'Emergency' | 'Hazard'

export interface GateController {
  id: string
  project_id: string
  gatepoint: string
  controller_label: string
  fatigue_level: FatigueLevel
  last_check_in: string
  coordinates: [number, number]
}

export type GateControllerCreate = Omit<GateController, 'id'>

export interface SiteAlertCreate {
  project_id: string
  gatepoint_id: string
  alert_type: SiteAlertType
  details: string
}

export interface SiteAlert extends SiteAlertCreate {
  id: string
  created_at: string
  status: string
}

export interface ImpactScenario {
  project_id: string
  lanes_closed: number
  duration_days: number
  speed_limit_kmh: number
}

export interface ImpactEstimate {
  estimated_delay_minutes: number
  traffic_impact: 'Low' | 'Moderate' | 'High'
  transit_impact: 'Low' | 'Moderate' | 'High'
  affected_routes: string[]
  note: string
}
