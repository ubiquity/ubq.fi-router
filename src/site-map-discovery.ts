/**
 * Optimized sitemap discovery without KV
 * Uses in-memory caching and static fallback
 */

import type { SitemapEntry, ServiceType } from './sitemap-generator'
import { discoverAllServices, discoverAllPlugins } from './core/discovery'
import { createSitemapEntry } from './sitemap-generator'

// Re-export core functions for test compatibility
export { discoverAllServices } from './core/discovery'

/**
 * Discover all services and plugins for sitemap
 */
export async function discoverAllForSitemap(githubToken: string, generationTimestamp: string): Promise<SitemapEntry[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required for sitemap generation')
  }

  // Discover both in parallel
  const [serviceMap, pluginMap] = await Promise.all([
    discoverAllServices(githubToken),
    discoverAllPlugins(githubToken)
  ])

  const entries: SitemapEntry[] = []

  // Convert services to sitemap entries
  for (const [subdomain, serviceType] of serviceMap) {
    const githubRepo = subdomain ? `ubiquity/${subdomain}.ubq.fi` : 'ubiquity/ubq.fi'
    entries.push(createSitemapEntry(subdomain, serviceType, undefined, githubRepo, generationTimestamp))
  }

  // Convert plugins to sitemap entries
  for (const [pluginName, variants] of pluginMap) {
    // Determine service type based on available variants
    let serviceType: ServiceType
    if (variants.main.available && variants.development.available) {
      serviceType = 'plugin-both'
    } else if (variants.main.available) {
      serviceType = 'plugin-deno'
    } else if (variants.development.available) {
      serviceType = 'plugin-pages'
    } else {
      serviceType = 'plugin-none'
    }

    const subdomain = `os-${pluginName}`
    const githubRepo = `ubiquity-os-marketplace/${pluginName}`
    const manifest = variants.main.manifest || variants.development.manifest
    entries.push(createSitemapEntry(subdomain, serviceType, manifest, githubRepo, generationTimestamp))
  }

  return entries
}

/**
 * Get sitemap entries - generates fresh each time (no KV caching)
 */
export async function getCachedSitemapEntries(
  githubToken: string,
  forceRefresh = false,
  request?: any
): Promise<SitemapEntry[]> {
  const generationTimestamp = new Date().toISOString()
  const entries = await discoverAllForSitemap(githubToken, generationTimestamp)

  return entries
}
