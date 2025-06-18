import type { ServiceType, ServiceDiscoveryResult } from './types'
import { buildDenoUrl, buildPagesUrl } from './utils'

// Request coalescing map to prevent duplicate service discoveries
const inFlightDiscoveries = new Map<string, Promise<ServiceType>>()

/**
 * Coalesce multiple discovery requests for the same subdomain
 * Prevents redundant parallel discoveries
 */
export async function coalesceDiscovery(subdomain: string, url: URL): Promise<ServiceType> {
  const discoveryKey = subdomain

  // Check if discovery is already in progress
  const inFlight = inFlightDiscoveries.get(discoveryKey)
  if (inFlight) {
    // Wait for the existing discovery to complete
    return await inFlight
  }

  // Start new discovery and store the promise
  const discoveryPromise = discoverServices(subdomain, url)
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
 * Returns: "deno", "pages", "both", or "none"
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
    return "both"
  } else if (denoExists) {
    return "deno"
  } else if (pagesExists) {
    return "pages"
  } else {
    return "none"
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
