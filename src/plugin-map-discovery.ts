/**
 * Optimized plugin-map discovery without KV
 * Uses in-memory caching and static fallback
 */

import type { PluginMapEntry, ServiceType } from './types'
import { discoverAllPlugins } from './core/discovery'
import { createPluginMapEntry } from './plugin-map-generator'
import { memoryGetJson, memoryPutJson } from './utils/memory-cache'

const PLUGIN_MAP_CACHE_KEY = 'plugin-map:entries'
const PLUGIN_MAP_CACHE_TTL = 60 * 60 // 1 hour in seconds

/**
 * Discover all plugins for plugin-map
 */
export async function discoverAllForPluginMap(githubToken: string, generationTimestamp: string): Promise<PluginMapEntry[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required for plugin-map generation')
  }

  // Get all plugin discovery results
  const pluginMap = await discoverAllPlugins(githubToken)

  const entries: PluginMapEntry[] = []

  // Convert to plugin-map entries
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

    const mainAvailable = variants.main.available
    const developmentAvailable = variants.development.available

    const discovery = {
      pluginName,
      serviceType,
      mainManifest: variants.main.manifest,
      developmentManifest: variants.development.manifest,
      mainAvailable,
      developmentAvailable
    }

    entries.push(createPluginMapEntry(discovery, generationTimestamp))
  }

  return entries
}

/**
 * Get plugin-map entries - uses in-memory caching, bypassed by forceRefresh
 */
export async function getCachedPluginMapEntries(
  githubToken: string,
  forceRefresh = false,
  request?: any
): Promise<PluginMapEntry[]> {
  // Bypass cache when forceRefresh is true
  if (forceRefresh) {
    const generationTimestamp = new Date().toISOString()
    const entries = await discoverAllForPluginMap(githubToken, generationTimestamp)
    // Cache the fresh result
    await memoryPutJson(PLUGIN_MAP_CACHE_KEY, entries, PLUGIN_MAP_CACHE_TTL)
    return entries
  }

  // Try to get from cache first
  const cached = await memoryGetJson<PluginMapEntry[]>(PLUGIN_MAP_CACHE_KEY)
  if (cached) {
    return cached
  }

  // Cache miss - generate fresh entries
  const generationTimestamp = new Date().toISOString()
  const entries = await discoverAllForPluginMap(githubToken, generationTimestamp)
  
  // Cache the result
  await memoryPutJson(PLUGIN_MAP_CACHE_KEY, entries, PLUGIN_MAP_CACHE_TTL)

  return entries
}
