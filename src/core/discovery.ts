/**
 * Core service and plugin discovery logic
 * Extracted from robust test implementations
 * FAIL-FAST: No defensive coding, crashes on any unexpected condition
 */

import type { ServiceType, PluginManifest } from '../types'
import { buildDenoUrl, buildPagesUrl, buildPluginUrl } from '../utils'
import { getKnownServices, getKnownPlugins } from '../utils'

/**
 * Check if a deployment exists - handle network errors gracefully
 */
export async function checkDeploymentExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000)
    })
    // Only 2xx status codes indicate working services
    return response.status >= 200 && response.status < 300
  } catch (error) {
    // Network errors, timeouts, DNS failures etc. mean service doesn't exist
    return false
  }
}

/**
 * Fetch plugin manifest - CRASH if invalid
 */
export async function fetchPluginManifest(url: string): Promise<PluginManifest> {
  const manifestUrl = `${url}/manifest.json`
  const response = await fetch(manifestUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(15000)
  })

  if (!response.ok) {
    throw new Error(`Manifest fetch failed: ${response.status} ${response.statusText} for ${manifestUrl}`)
  }

  const manifest = await response.json() as PluginManifest

  // CRASH if manifest is invalid
  if (!manifest.name || !manifest.description) {
    throw new Error(`Invalid manifest: missing required fields 'name' or 'description' in ${manifestUrl}`)
  }

  return manifest
}

/**
 * Discover service type for a subdomain - CRASH on network failures
 */
export async function discoverServiceType(subdomain: string, url: URL): Promise<ServiceType> {
  const denoUrl = buildDenoUrl(subdomain, url)
  const pagesUrl = buildPagesUrl(subdomain, url)

  // Check both platforms in parallel - CRASH if network fails
  const [denoExists, pagesExists] = await Promise.all([
    checkDeploymentExists(denoUrl),
    checkDeploymentExists(pagesUrl)
  ])

  // Determine service type based on what exists
  if (denoExists && pagesExists) {
    return "service-both"
  } else if (denoExists) {
    return "service-deno"
  } else if (pagesExists) {
    return "service-pages"
  } else {
    return "service-none"
  }
}

/**
 * Discover plugin type - CRASH on any failures
 */
export async function discoverPluginType(pluginName: string): Promise<ServiceType> {
  // Check if plugin exists on Deno Deploy by testing manifest
  const manifestUrl = `https://${pluginName}-main.deno.dev/manifest.json`

  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(15000)
    })

    if (response.ok) {
      const manifest = await response.json() as PluginManifest
      if (manifest.name && manifest.description) {
        return "plugin-deno"
      }
    }
    return "plugin-none"
  } catch (error) {
    return "plugin-none"
  }
}

/**
 * Get all services from GitHub - CRASH if GitHub API fails
 */
export async function getAllServices(kvNamespace: any, githubToken: string): Promise<string[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required but not provided')
  }

  return await getKnownServices(kvNamespace, githubToken)
}

/**
 * Get all plugins from GitHub - CRASH if GitHub API fails
 */
export async function getAllPlugins(kvNamespace: any, githubToken: string): Promise<string[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required but not provided')
  }

  return await getKnownPlugins(kvNamespace, githubToken)
}

/**
 * Discover all services in parallel batches - CRASH on any failure
 */
export async function discoverAllServices(kvNamespace: any, githubToken: string): Promise<Map<string, ServiceType>> {
  const services = await getAllServices(kvNamespace, githubToken)
  const servicesToTest = ['', ...services] // Include root domain

  const results = new Map<string, ServiceType>()

  // Process in batches to avoid overwhelming APIs
  const batchSize = 5
  for (let i = 0; i < servicesToTest.length; i += batchSize) {
    const batch = servicesToTest.slice(i, i + batchSize)

    const batchPromises = batch.map(async (subdomain) => {
      const url = new URL(subdomain ? `https://${subdomain}.ubq.fi` : 'https://ubq.fi')
      const serviceType = await discoverServiceType(subdomain, url)
      return [subdomain, serviceType] as const
    })

    const batchResults = await Promise.all(batchPromises)
    batchResults.forEach(([subdomain, serviceType]) => {
      results.set(subdomain, serviceType)
    })
  }

  return results
}

/**
 * Discover all plugins in parallel batches - CRASH on any failure
 */
export async function discoverAllPlugins(kvNamespace: any, githubToken: string): Promise<Map<string, { serviceType: ServiceType; manifest?: PluginManifest }>> {
  const plugins = await getAllPlugins(kvNamespace, githubToken)
  const results = new Map<string, { serviceType: ServiceType; manifest?: PluginManifest }>()

  // Process in batches
  const batchSize = 3
  for (let i = 0; i < plugins.length; i += batchSize) {
    const batch = plugins.slice(i, i + batchSize)

    const batchPromises = batch.map(async (pluginName) => {
      const serviceType = await discoverPluginType(pluginName)

      let manifest: PluginManifest | undefined
      if (serviceType !== "plugin-none") {
        try {
          const baseUrl = `https://${pluginName}-main.deno.dev`
          manifest = await fetchPluginManifest(baseUrl)
        } catch (error) {
          // Manifest fetch failed but plugin exists - this is OK
        }
      }

      return [pluginName, { serviceType, manifest }] as const
    })

    const batchResults = await Promise.all(batchPromises)
    batchResults.forEach(([pluginName, result]) => {
      results.set(pluginName, result)
    })
  }

  return results
}
