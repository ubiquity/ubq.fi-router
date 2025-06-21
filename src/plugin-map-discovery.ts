/**
 * Simplified plugin-map discovery using core modules
 * No defensive coding - crashes on any failure
 */

import type { PluginMapEntry } from './types'
import { discoverAllPlugins } from './core/discovery'
import { getFromCache, putToCache, CACHE_CONFIGS } from './core/cache'
import { createPluginMapEntry } from './plugin-map-generator'

/**
 * Discover all plugins for plugin-map - CRASH on any failure
 */
export async function discoverAllForPluginMap(kvNamespace: any, githubToken?: string): Promise<PluginMapEntry[]> {
  const token = githubToken || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for plugin-map generation (provide as parameter or environment variable)')
  }

  // Get all plugin discovery results - CRASH if fails
  const pluginMap = await discoverAllPlugins(kvNamespace, token)

  const entries: PluginMapEntry[] = []

  // Convert to plugin-map entries
  for (const [pluginName, { serviceType, manifest }] of pluginMap) {
    // For plugin-map, we need detailed deployment info
    const mainAvailable = serviceType !== 'plugin-none'
    const developmentAvailable = false // Simplified - we only check main for now

    const discovery = {
      pluginName,
      serviceType,
      mainManifest: manifest,
      developmentManifest: undefined,
      mainAvailable,
      developmentAvailable
    }

    entries.push(createPluginMapEntry(discovery))
  }

  return entries
}

/**
 * Get cached plugin-map entries or generate fresh - CRASH on any failure
 */
export async function getCachedPluginMapEntries(
  kvNamespace: any,
  forceRefresh = false,
  githubToken?: string,
  // This is a diagnostic parameter, not for general use
  // It is used to pass the request object for logging purposes
  request?: any
  ): Promise<PluginMapEntry[]> {
  const CACHE_KEY = 'entries'

  if (!forceRefresh) {
    const cached = await getFromCache<PluginMapEntry[]>(kvNamespace, CACHE_KEY, CACHE_CONFIGS.PLUGIN_MAP)
    if (cached) {
      return cached
    }
  }

  // Generate fresh entries - CRASH if fails
  const entries = await discoverAllForPluginMap(kvNamespace, githubToken)

  // Cache the results - CRASH if fails
  await putToCache(kvNamespace, CACHE_KEY, entries, CACHE_CONFIGS.PLUGIN_MAP, request)

  return entries
}
