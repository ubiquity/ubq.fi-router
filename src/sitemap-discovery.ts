/**
 * Optimized sitemap discovery with aggressive change detection
 * No defensive coding - crashes on any failure
 */

import type { SitemapEntry } from './sitemap-generator'
import { discoverAllServices, discoverAllPlugins } from './core/discovery'
import { getFromCache, putToCache, CACHE_CONFIGS } from './core/cache'
import { createSitemapEntry } from './sitemap-generator'
import { shouldRegenerateSitemap, recordSitemapGeneration } from './utils/change-detection'

// Re-export core functions for test compatibility
export { discoverAllServices } from './core/discovery'

/**
 * Discover all services and plugins for sitemap - CRASH on any failure
 */
export async function discoverAllForSitemap(kvNamespace: any, githubToken: string, generationTimestamp: string): Promise<SitemapEntry[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required for sitemap generation')
  }

  // Discover both in parallel - CRASH if either fails
  const [serviceMap, pluginMap] = await Promise.all([
    discoverAllServices(kvNamespace, githubToken),
    discoverAllPlugins(kvNamespace, githubToken)
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
 * Get cached sitemap entries with smart change detection - CRASH on any failure
 */
export async function getCachedSitemapEntries(
  kvNamespace: any,
  forceRefresh = false,
  githubToken: string,
  // This is a diagnostic parameter, not for general use
  // It is used to pass the request object for logging purposes
  request?: any
  ): Promise<SitemapEntry[]> {
  const CACHE_KEY = 'entries'

  // Check if regeneration is needed based on repository changes
  const needsRegeneration = await shouldRegenerateSitemap(kvNamespace, forceRefresh)

  if (!needsRegeneration) {
    // Try to get from cache if no changes detected
    const cached = await getFromCache<SitemapEntry[]>(kvNamespace, CACHE_KEY, CACHE_CONFIGS.SITEMAP)
    if (cached) {
      console.log(`📦 Using cached sitemap entries (${cached.length} entries) - no repository changes detected.`)
      return cached
    }
  }

  // Generate fresh entries - CRASH if fails
  console.log(`🔄 Generating fresh sitemap entries...`)
  const generationTimestamp = new Date().toISOString()
  const entries = await discoverAllForSitemap(kvNamespace, githubToken, generationTimestamp)

  // Cache the results - CRASH if fails
  await putToCache(kvNamespace, CACHE_KEY, entries, CACHE_CONFIGS.SITEMAP, request)

  // Record this generation to track future changes
  await recordSitemapGeneration(kvNamespace)

  console.log(`✅ Generated and cached ${entries.length} sitemap entries.`)
  return entries
}