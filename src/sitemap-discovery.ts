/**
 * Bulk service discovery for sitemap generation
 * Efficiently discovers all services and plugins with their metadata
 */

import type { ServiceType, PluginManifest } from './types'
import type { SitemapEntry } from './sitemap-generator'
import { getKnownServices, getKnownPlugins, buildPluginUrl, isPluginDomain } from './utils'
import { coalesceDiscovery } from './service-discovery'
import { createSitemapEntry } from './sitemap-generator'

interface ServiceDiscoveryResult {
  subdomain: string
  serviceType: ServiceType
  pluginManifest?: PluginManifest
  githubRepo?: string
}

/**
 * Fetch plugin manifest with error handling
 */
async function fetchPluginManifest(pluginName: string): Promise<PluginManifest | null> {
  try {
    const manifestUrl = `https://${pluginName}.deno.dev/manifest.json`
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })

    if (response.status >= 200 && response.status < 300) {
      const manifest = await response.json() as PluginManifest
      // Validate basic structure
      if (manifest.name && manifest.description) {
        return manifest
      }
    }
    return null
  } catch (error) {
    console.warn(`Failed to fetch manifest for ${pluginName}:`, error)
    return null
  }
}

/**
 * Discover all standard services (non-plugin subdomains)
 */
async function discoverStandardServices(kvNamespace: any, githubToken: string): Promise<ServiceDiscoveryResult[]> {
  const knownServices = await getKnownServices(kvNamespace, githubToken)
  const results: ServiceDiscoveryResult[] = []

  // Always include root domain
  const servicesToDiscover = ['', ...knownServices]

  // Discover services in parallel batches to avoid overwhelming APIs
  const batchSize = 5
  for (let i = 0; i < servicesToDiscover.length; i += batchSize) {
    const batch = servicesToDiscover.slice(i, i + batchSize)

    const batchPromises = batch.map(async (subdomain) => {
      try {
        const url = new URL(subdomain ? `https://${subdomain}.ubq.fi` : 'https://ubq.fi')
        const serviceType = await coalesceDiscovery(subdomain, url, kvNamespace, githubToken)

        const githubRepo = subdomain ? `${subdomain}.ubq.fi` : 'ubq.fi'

        return {
          subdomain,
          serviceType,
          githubRepo: `ubiquity/${githubRepo}`
        }
      } catch (error) {
        console.warn(`Failed to discover service for ${subdomain}:`, error)
        return {
          subdomain,
          serviceType: 'service-none' as ServiceType,
          githubRepo: subdomain ? `ubiquity/${subdomain}.ubq.fi` : 'ubiquity/ubq.fi'
        }
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
  }

  return results
}

/**
 * Discover all plugin services
 */
async function discoverPluginServices(kvNamespace: any, githubToken: string): Promise<ServiceDiscoveryResult[]> {
  try {
    const knownPlugins = await getKnownPlugins(kvNamespace, githubToken)
    const results: ServiceDiscoveryResult[] = []

    // Process plugins in batches
    const batchSize = 3
    for (let i = 0; i < knownPlugins.length; i += batchSize) {
      const batch = knownPlugins.slice(i, i + batchSize)

      const batchPromises = batch.map(async (pluginName: string) => {
        try {
          // Create plugin domain for discovery
          const pluginDomain = `os-${pluginName}.ubq.fi`
          const url = new URL(`https://${pluginDomain}`)

          // Discover service type
          const serviceType = await coalesceDiscovery(`os-${pluginName}`, url, kvNamespace, githubToken)

          let pluginManifest: PluginManifest | undefined

          // If plugin exists, try to fetch manifest
          if (!serviceType.endsWith('-none')) {
            // Try to get manifest from main deployment
            const mainPluginName = `${pluginName}-main`
            const manifest = await fetchPluginManifest(mainPluginName)
            if (manifest) {
              pluginManifest = manifest
            }
          }

          return {
            subdomain: `os-${pluginName}`,
            serviceType,
            pluginManifest,
            githubRepo: `ubiquity-os-marketplace/${pluginName}`
          }
        } catch (error) {
          console.warn(`Failed to discover plugin ${pluginName}:`, error)
          return {
            subdomain: `os-${pluginName}`,
            serviceType: 'plugin-none' as ServiceType,
            githubRepo: `ubiquity-os-marketplace/${pluginName}`
          }
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
    }

    return results
  } catch (error) {
    console.error('Failed to discover plugins:', error)
    return []
  }
}

/**
 * Discover all services and plugins for sitemap generation
 */
export async function discoverAllServices(kvNamespace: any, githubToken: string): Promise<SitemapEntry[]> {
  console.log('🔍 Starting bulk service discovery for sitemap...')

  try {
    // Discover both standard services and plugins in parallel
    const [standardServices, pluginServices] = await Promise.all([
      discoverStandardServices(kvNamespace, githubToken),
      discoverPluginServices(kvNamespace, githubToken)
    ])

    console.log(`📋 Discovered ${standardServices.length} standard services`)
    console.log(`🔌 Discovered ${pluginServices.length} plugin services`)

    // Convert all results to sitemap entries
    const allServices = [...standardServices, ...pluginServices]
    const sitemapEntries = allServices.map(service =>
      createSitemapEntry(
        service.subdomain,
        service.serviceType,
        service.pluginManifest,
        service.githubRepo
      )
    )

    // Filter and sort entries
    const validEntries = sitemapEntries
      .filter(entry => !entry.serviceType.endsWith('-none'))
      .sort((a, b) => b.priority - a.priority) // Sort by priority (highest first)

    console.log(`✅ Generated ${validEntries.length} valid sitemap entries`)

    return sitemapEntries // Return all entries, filtering happens in generator
  } catch (error) {
    console.error('Failed to discover services for sitemap:', error)
    throw error
  }
}

/**
 * Generate sitemap entries with caching
 */
export async function getCachedSitemapEntries(kvNamespace: any, forceRefresh = false, githubToken: string): Promise<SitemapEntry[]> {
  const CACHE_KEY = 'sitemap:entries'
  const CACHE_TTL = 6 * 60 * 60 // 6 hours

  if (!forceRefresh) {
    try {
      const cached = await kvNamespace.get(CACHE_KEY, { type: 'json' })
      if (cached && Array.isArray(cached)) {
        console.log('📦 Using cached sitemap entries')
        return cached as SitemapEntry[]
      }
    } catch (error) {
      console.warn('Failed to read sitemap cache:', error)
    }
  }

  // Generate fresh entries
  const entries = await discoverAllServices(kvNamespace, githubToken)

  // Cache the results
  try {
    await kvNamespace.put(CACHE_KEY, JSON.stringify(entries), { expirationTtl: CACHE_TTL })
    console.log('💾 Cached sitemap entries')
  } catch (error) {
    console.warn('Failed to cache sitemap entries:', error)
  }

  return entries
}
