/**
 * Simplified sitemap discovery using core modules
 * No defensive coding - crashes on any failure
 */

import type { SitemapEntry } from './sitemap-generator'
import { discoverAllServices, discoverAllPlugins } from './core/discovery'
import { getFromCache, putToCache, CACHE_CONFIGS } from './core/cache'
import { createSitemapEntry } from './sitemap-generator'

// Re-export core functions for test compatibility
export { discoverAllServices } from './core/discovery'

/**
 * Discover all services and plugins for sitemap - CRASH on any failure
 */
export async function discoverAllForSitemap(kvNamespace: any, githubToken: string | undefined, generationTimestamp: string): Promise<SitemapEntry[]> {
  const token = githubToken || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for sitemap generation (provide as parameter or environment variable)')
  }

  // Discover both in parallel - CRASH if either fails
  const [serviceMap, pluginMap] = await Promise.all([
    discoverAllServices(kvNamespace, token),
    discoverAllPlugins(kvNamespace, token)
  ])

  const entries: SitemapEntry[] = []

  // Convert services to sitemap entries
  for (const [subdomain, serviceType] of serviceMap) {
    const githubRepo = subdomain ? `ubiquity/${subdomain}.ubq.fi` : 'ubiquity/ubq.fi'
    entries.push(createSitemapEntry(subdomain, serviceType, undefined, githubRepo, generationTimestamp))
  }

  // Convert plugins to sitemap entries
  for (const [pluginName, { serviceType, manifest }] of pluginMap) {
    const subdomain = `os-${pluginName}`
    const githubRepo = `ubiquity-os-marketplace/${pluginName}`
    entries.push(createSitemapEntry(subdomain, serviceType, manifest, githubRepo, generationTimestamp))
  }

  return entries
}

/**
 * Get cached sitemap entries or generate fresh - CRASH on any failure
 */
export async function getCachedSitemapEntries(
  kvNamespace: any,
  forceRefresh = false,
  githubToken?: string,
  // This is a diagnostic parameter, not for general use
  // It is used to pass the request object for logging purposes
  request?: any
  ): Promise<SitemapEntry[]> {
  const CACHE_KEY = 'entries'

  if (!forceRefresh) {
    const cached = await getFromCache<SitemapEntry[]>(kvNamespace, CACHE_KEY, CACHE_CONFIGS.SITEMAP)
    if (cached) {
      return cached
    }
  }

  // Generate fresh entries - CRASH if fails
  const generationTimestamp = new Date().toISOString()
  const entries = await discoverAllForSitemap(kvNamespace, githubToken, generationTimestamp)

  // Cache the results - CRASH if fails
  await putToCache(kvNamespace, CACHE_KEY, entries, CACHE_CONFIGS.SITEMAP, request)

  return entries
}
