import type { ServiceType, ServiceDiscoveryResult, PluginManifest } from './types'
import { buildDenoUrl, buildPagesUrl, buildPluginUrl, buildPluginPagesUrl, isPluginDomain } from './utils'

// Request coalescing map to prevent duplicate service discoveries
const inFlightDiscoveries = new Map<string, Promise<ServiceType>>()

/**
 * Coalesce multiple discovery requests for the same subdomain
 * Prevents redundant parallel discoveries
 */
export async function coalesceDiscovery(subdomain: string, url: URL, kvNamespace: any): Promise<ServiceType> {
  const discoveryKey = subdomain

  // Check if discovery is already in progress
  const inFlight = inFlightDiscoveries.get(discoveryKey)
  if (inFlight) {
    // Wait for the existing discovery to complete
    return await inFlight
  }

  // Start new discovery and store the promise
  const discoveryPromise = isPluginDomain(url.hostname)
    ? discoverPlugin(url.hostname, url, kvNamespace)
    : discoverServices(subdomain, url)
  inFlightDiscoveries.set(discoveryKey, discoveryPromise)

  try {
    const result = await discoveryPromise
    return result
  } finally {
    // Clean up after discovery completes
    inFlightDiscoveries.delete(discoveryKey)
  }
}

/**
 * Discover which services (Deno Deploy, Cloudflare Pages) exist for a subdomain
 * OPTIMIZED: Checks both services in parallel
 * Returns: "service-deno", "service-pages", "service-both", or "service-none"
 */
async function discoverServices(subdomain: string, url: URL): Promise<ServiceType> {
  const denoUrl = buildDenoUrl(subdomain, url)
  const pagesUrl = buildPagesUrl(subdomain, url)

  // Check both services in parallel for better performance
  const [denoExists, pagesExists] = await Promise.all([
    serviceExists(denoUrl),
    serviceExists(pagesUrl)
  ])

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
 * Discover plugin by checking manifest.json endpoint on both platforms
 * OPTIMIZED: Checks both Deno Deploy and Cloudflare Pages in parallel
 * Returns: "plugin-deno", "plugin-pages", "plugin-both", or "plugin-none"
 */
async function discoverPlugin(hostname: string, url: URL, kvNamespace: any): Promise<ServiceType> {
  try {
    const [pluginDenoUrl, pluginPagesUrl] = await Promise.all([
      buildPluginUrl(hostname, url, kvNamespace),
      buildPluginPagesUrl(hostname, url, kvNamespace)
    ])

    const denoManifestUrl = `${pluginDenoUrl.replace(url.pathname + url.search, '')}/manifest.json`
    const pagesManifestUrl = `${pluginPagesUrl.replace(url.pathname + url.search, '')}/manifest.json`

    // Check both platforms in parallel for better performance
    const [denoExists, pagesExists] = await Promise.all([
      pluginExists(denoManifestUrl),
      pluginExists(pagesManifestUrl)
    ])

    if (denoExists && pagesExists) {
      return "plugin-both"
    } else if (denoExists) {
      return "plugin-deno"
    } else if (pagesExists) {
      return "plugin-pages"
    } else {
      return "plugin-none"
    }
  } catch (error) {
    // Plugin name validation failed (unknown plugin), return plugin-none
    console.log(`Plugin discovery failed for ${hostname}:`, (error as Error).message)
    return "plugin-none"
  }
}

/**
 * Check if a plugin exists by validating its manifest.json endpoint
 */
async function pluginExists(manifestUrl: string): Promise<boolean> {
  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    })

    if (response.status >= 200 && response.status < 300) {
      // Validate that response contains valid JSON manifest
      const manifest = await response.json() as PluginManifest

      // Basic validation - manifest should have name and description
      return !!(manifest.name && manifest.description)
    }

    return false
  } catch (error) {
    // Network errors, timeouts, invalid JSON, etc. - plugin doesn't exist
    return false
  }
}

/**
 * Check if a service exists by testing for successful responses
 * Only 2xx status codes indicate a working service
 */
async function serviceExists(testUrl: string): Promise<boolean> {
  try {
    const response = await fetch(testUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    })
    // Only consider 2xx status codes as "service exists"
    // This excludes Cloudflare errors (5xx), DNS errors, etc.
    return response.status >= 200 && response.status < 300
  } catch (error) {
    // Network errors, timeouts, etc. - assume service doesn't exist
    return false
  }
}
