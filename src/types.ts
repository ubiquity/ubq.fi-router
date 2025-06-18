export type ServiceType = "deno" | "pages" | "both" | "none"

export type CacheControlValue = "refresh" | "clear" | "clear-all" | null

export interface RouteConfig {
  subdomain: string
  serviceType: ServiceType
}

export interface ServiceDiscoveryResult {
  denoExists: boolean
  pagesExists: boolean
}
