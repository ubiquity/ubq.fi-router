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
  // More tolerant existence check: try HEAD first with short timeout,
  // accept 2xx/3xx/401/403/405 as "exists"; fallback to GET on failure.
  const HEAD_TIMEOUT_MS = 5000
  const GET_TIMEOUT_MS = 5000

  try {
    const headResp = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS)
    })

    if (
      (headResp.status >= 200 && headResp.status < 400) ||
      headResp.status === 401 ||
      headResp.status === 403 ||
      headResp.status === 405
    ) {
      return true
    }

    if (headResp.status === 404) {
      return false
    }
    // For other statuses, fall through to GET
  } catch {
    // Ignore and try GET
  }

  try {
    const getResp = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(GET_TIMEOUT_MS)
    })
    // Treat any non-5xx as existence; 5xx implies upstream down
    if (getResp.status >= 200 && getResp.status < 500) {
      return true
    }
    return false
  } catch {
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
  // Check both Deno and Pages
  const denoManifestUrl = `https://${pluginName}-main.deno.dev/manifest.json`
  const pagesUrl = `https://${pluginName}.pages.dev/`

  const [denoOk, pagesOk] = await Promise.all([
    (async () => {
      try {
        const resp = await fetch(denoManifestUrl, { method: 'GET', signal: AbortSignal.timeout(5000) })
        if (!resp.ok) return false
        const manifest = await resp.json() as PluginManifest
        return Boolean(manifest?.name && manifest?.description)
      } catch {
        return false
      }
    })(),
    checkDeploymentExists(pagesUrl)
  ])

  if (denoOk && pagesOk) return 'plugin-both'
  if (denoOk) return 'plugin-deno'
  if (pagesOk) return 'plugin-pages'
  return 'plugin-none'
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
