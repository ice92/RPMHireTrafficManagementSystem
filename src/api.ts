import type { GateController, GateControllerCreate, ImpactEstimate, ImpactScenario, Project, SiteAlert, SiteAlertCreate, TrafficAsset } from './types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) throw new Error(`API request failed (${response.status})`)
  return response.json() as Promise<T>
}

export const api = {
  projects: () => request<Project[]>('/projects'),
  assets: () => request<TrafficAsset[]>('/assets'),
  gateControllers: (projectId?: string) => request<GateController[]>(`/gate-controllers${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),
  createGateController: (controller: GateControllerCreate) =>
    request<GateController>('/gate-controllers', { method: 'POST', body: JSON.stringify(controller) }),
  updateGatePosition: (gatepointId: string, coordinates: [number, number]) =>
    request<GateController>(`/gate-controllers/${encodeURIComponent(gatepointId)}/position`, {
      method: 'PATCH',
      body: JSON.stringify({ coordinates }),
    }),
  alerts: () => request<SiteAlert[]>('/alerts'),
  createAlert: (alert: SiteAlertCreate) =>
    request<SiteAlert>('/alerts', { method: 'POST', body: JSON.stringify(alert) }),
  estimate: (scenario: ImpactScenario) =>
    request<ImpactEstimate>('/scenarios/estimate', {
      method: 'POST',
      body: JSON.stringify(scenario),
    }),
  createProject: (project: Omit<Project, 'id'>) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(project) }),
  createAsset: (asset: Omit<TrafficAsset, 'id'>) =>
    request<TrafficAsset>('/assets', { method: 'POST', body: JSON.stringify(asset) }),
}
