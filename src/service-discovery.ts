import type { ServiceType } from './types'
import { discoverServiceType, discoverPluginType } from './core/discovery'
import { isPluginDomain } from './utils'
import { getPluginName } from './utils/get-plugin-name'

// Request coalescing map to prevent duplicate service discoveries
const inFlightDiscoveries = new Map<string, Promise<ServiceType>>()

/**
 * Coalesce multiple discovery requests for the same subdomain
 * Prevents redundant parallel discoveries
 * Uses core discovery modules - CRASH on failures
 */
export async function coalesceDiscovery(subdomain: string, url: URL, kvNamespace: any, githubToken: string): Promise<ServiceType> {
  const discoveryKey = subdomain

  // Check if discovery is already in progress
  const inFlight = inFlightDiscoveries.get(discoveryKey)
  if (inFlight) {
    return await inFlight
  }

  // Start new discovery using core modules - CRASH if fails
  const discoveryPromise = isPluginDomain(url.hostname)
    ? discoverPluginType(await getPluginName(url.hostname, kvNamespace, githubToken, false))
    : discoverServiceType(subdomain, url)
  
  inFlightDiscoveries.set(discoveryKey, discoveryPromise)

  try {
    return await discoveryPromise
  } finally {
    inFlightDiscoveries.delete(discoveryKey)
  }
}
