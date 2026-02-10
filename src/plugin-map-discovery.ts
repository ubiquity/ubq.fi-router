/**
 * Optimized plugin-map discovery without KV
 * Uses in-memory caching and static fallback
 */

import type { PluginMapEntry, ServiceType } from './types'
import { discoverAllPlugins } from './core/discovery'
import { createPluginMapEntry } from './plugin-map-generator'

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
 * Get plugin-map entries - generates fresh each time (no KV caching)
 */
export async function getCachedPluginMapEntries(
  githubToken: string
): Promise<PluginMapEntry[]> {
  const generationTimestamp = new Date().toISOString()
  const entries = await discoverAllForPluginMap(githubToken, generationTimestamp)

  return entries
}
