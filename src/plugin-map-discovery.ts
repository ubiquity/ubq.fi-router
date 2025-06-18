/**
 * Plugin-map discovery for ubq.fi router
 * Discovers all plugins with enhanced metadata and deployment information
 */

import type { ServiceType, PluginManifest, PluginMapEntry } from './types'
import { getKnownPlugins } from './utils'
import { createPluginMapEntry } from './plugin-map-generator'

interface PluginDiscoveryResult {
  pluginName: string
  serviceType: ServiceType
  mainManifest?: PluginManifest
  developmentManifest?: PluginManifest
  mainAvailable: boolean
  developmentAvailable: boolean
}

/**
 * Fetch plugin manifest with error handling
 */
async function fetchPluginManifest(deploymentName: string): Promise<PluginManifest | null> {
  try {
    const manifestUrl = `https://${deploymentName}.deno.dev/manifest.json`
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
    console.warn(`Failed to fetch manifest for ${deploymentName}:`, error)
    return null
  }
}

/**
 * Check if a deployment exists by testing the manifest endpoint
 */
async function checkDeploymentExists(deploymentName: string): Promise<boolean> {
  try {
    const manifestUrl = `https://${deploymentName}.deno.dev/manifest.json`
    const response = await fetch(manifestUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    })
    return response.status >= 200 && response.status < 300
  } catch (error) {
    return false
  }
}

/**
 * Discover a single plugin's deployments and metadata
 */
async function discoverPlugin(pluginName: string): Promise<PluginDiscoveryResult> {
  const mainDeploymentName = `${pluginName}-main`
  const developmentDeploymentName = `${pluginName}-development`

  console.log(`🔍 Discovering plugin: ${pluginName}`)

  // Check deployments in parallel
  const [mainExists, developmentExists] = await Promise.all([
    checkDeploymentExists(mainDeploymentName),
    checkDeploymentExists(developmentDeploymentName)
  ])

  let mainManifest: PluginManifest | undefined
  let developmentManifest: PluginManifest | undefined

  // Fetch manifests for existing deployments
  if (mainExists) {
    mainManifest = await fetchPluginManifest(mainDeploymentName) || undefined
  }

  if (developmentExists) {
    developmentManifest = await fetchPluginManifest(developmentDeploymentName) || undefined
  }

  // Determine service type based on what's available
  let serviceType: ServiceType
  if (mainExists && developmentExists) {
    serviceType = 'plugin-both'
  } else if (mainExists || developmentExists) {
    serviceType = 'plugin-deno'
  } else {
    serviceType = 'plugin-none'
  }

  console.log(`📦 Plugin ${pluginName}: ${serviceType} (main: ${mainExists}, dev: ${developmentExists})`)

  return {
    pluginName,
    serviceType,
    mainManifest,
    developmentManifest,
    mainAvailable: mainExists,
    developmentAvailable: developmentExists
  }
}

/**
 * Discover all plugins for plugin-map generation
 */
export async function discoverAllPlugins(kvNamespace: any, githubToken: string): Promise<PluginMapEntry[]> {
  console.log('🔍 Starting bulk plugin discovery for plugin-map...')

  try {
    // Get all known plugins from GitHub
    const knownPlugins = await getKnownPlugins(kvNamespace, githubToken)
    console.log(`📋 Found ${knownPlugins.length} plugins in GitHub org`)

    const results: PluginMapEntry[] = []

    // Process plugins in batches to avoid overwhelming APIs
    const batchSize = 3
    for (let i = 0; i < knownPlugins.length; i += batchSize) {
      const batch = knownPlugins.slice(i, i + batchSize)

      const batchPromises = batch.map(async (pluginName: string) => {
        try {
          const discovery = await discoverPlugin(pluginName)
          return createPluginMapEntry(discovery)
        } catch (error) {
          console.warn(`Failed to discover plugin ${pluginName}:`, error)
          return createPluginMapEntry({
            pluginName,
            serviceType: 'plugin-none',
            mainAvailable: false,
            developmentAvailable: false
          })
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      // Small delay between batches to be gentle on APIs
      if (i + batchSize < knownPlugins.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // Filter and sort entries
    const validEntries = results
      .filter(entry => entry.serviceType !== 'plugin-none')
      .sort((a, b) => b.priority - a.priority)

    console.log(`✅ Generated ${validEntries.length} valid plugin-map entries from ${results.length} total`)

    return results // Return all entries, filtering happens in generator
  } catch (error) {
    console.error('Failed to discover plugins for plugin-map:', error)
    throw error
  }
}

/**
 * Generate plugin-map entries with caching
 */
export async function getCachedPluginMapEntries(kvNamespace: any, forceRefresh = false, githubToken: string): Promise<PluginMapEntry[]> {
  const CACHE_KEY = 'plugin-map:entries'
  const CACHE_TTL = 2 * 60 * 60 // 2 hours

  if (!forceRefresh) {
    try {
      const cached = await kvNamespace.get(CACHE_KEY, { type: 'json' })
      if (cached && Array.isArray(cached)) {
        console.log('📦 Using cached plugin-map entries')
        return cached as PluginMapEntry[]
      }
    } catch (error) {
      console.warn('Failed to read plugin-map cache:', error)
    }
  }

  // Generate fresh entries
  const entries = await discoverAllPlugins(kvNamespace, githubToken)

  // Cache the results
  try {
    await kvNamespace.put(CACHE_KEY, JSON.stringify(entries), { expirationTtl: CACHE_TTL })
    console.log('💾 Cached plugin-map entries')
  } catch (error) {
    console.warn('Failed to cache plugin-map entries:', error)
  }

  return entries
}
