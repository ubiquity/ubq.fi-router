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

export interface PluginMapEntry {
  url: string
  pluginName: string
  displayName: string
  description: string
  serviceType: ServiceType
  deployments: {
    main: {
      available: boolean
      url: string
      manifest?: PluginManifest
    }
    development: {
      available: boolean
      url: string
      manifest?: PluginManifest
    }
  }
  commands?: Record<string, any>
  listeners?: string[]
  configuration?: Record<string, any>
  homepage_url?: string
  github: {
    repo: string
    url: string
  }
  priority: number
  changefreq: 'daily' | 'weekly' | 'monthly'
  lastmod: string
}

export interface JsonPluginMap {
  version: string
  generated: string
  generator: string
  totalPlugins: number
  plugins: PluginMapEntry[]
}
