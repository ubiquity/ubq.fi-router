/**
 * Optimized plugin-map discovery without KV
 * Uses in-memory caching and static fallback
 */

import type { PluginMapEntry } from './types'
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
  for (const [pluginName, { serviceType, manifest }] of pluginMap) {
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

    entries.push(createPluginMapEntry(discovery, generationTimestamp))
  }

  return entries
}

/**
 * Get plugin-map entries - generates fresh each time (no KV caching)
 */
export async function getCachedPluginMapEntries(
  githubToken: string,
  forceRefresh = false,
  request?: any
): Promise<PluginMapEntry[]> {
  
  const generationTimestamp = new Date().toISOString()
  const entries = await discoverAllForPluginMap(githubToken, generationTimestamp)

  return entries
}
