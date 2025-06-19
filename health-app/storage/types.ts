/**
 * Health monitoring data types for Deno Deploy
 */

export interface HealthCheckResult {
  healthy: boolean
  status: number
  error?: string
  lastChecked: string
  checkedBy?: string
}

export interface ServiceHealth extends HealthCheckResult {
  name: string
  domain: string
  serviceType?: string
  denoExists?: boolean
  pagesExists?: boolean
}

export interface PluginHealth extends HealthCheckResult {
  name: string
  variant: string
  domain: string
  manifestValid?: boolean
  displayName?: string
  description?: string
}

export interface CachedHealthData {
  services: { [key: string]: ServiceHealth }
  plugins: { [key: string]: PluginHealth }
  lastGlobalUpdate: string
}

export interface ServicesListResponse {
  services: string[]
  plugins: {
    name: string
    variants: string[]
    url: string
    routingDomain: string
    displayName?: string
    description?: string
  }[]
  timestamp: string
}

export interface ProxyStatusResponse {
  healthy: boolean
  status: number
  statusText: string
  deploymentStatus: string
  error?: string
  timestamp: string
}

export interface ProxyManifestResponse {
  manifestValid: boolean
  status: number
  statusText: string
  manifest?: any
  error?: string
  timestamp: string
}

export interface UpdateHealthRequest {
  type: 'service' | 'plugin'
  key: string
  result: HealthCheckResult
}

export interface LegacyHealthResponse {
  lastUpdated: string
  services: ServiceHealth[]
  plugins: PluginHealth[]
  summary: {
    totalServices: number
    healthyServices: number
    totalPlugins: number
    healthyPlugins: number
    overallHealthPercentage: number
  }
}
