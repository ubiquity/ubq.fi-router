export type ServiceType = 
  | "service-deno" 
  | "service-pages" 
  | "service-both" 
  | "service-none"
  | "plugin-deno" 
  | "plugin-pages" 
  | "plugin-both" 
  | "plugin-none"

export type CacheControlValue = "refresh" | "clear" | "clear-all" | null

export interface RouteConfig {
  subdomain: string
  serviceType: ServiceType
}

export interface ServiceDiscoveryResult {
  denoExists: boolean
  pagesExists: boolean
}

export interface PluginManifest {
  name: string
  description: string
  "ubiquity:listeners"?: string[]
  commands?: Record<string, any>
  configuration?: Record<string, any>
  homepage_url?: string
}
