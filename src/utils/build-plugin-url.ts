import { getPluginName } from "./get-plugin-name.ts"
import { getCachedRoute, cacheRoute } from "../core/cache.ts"

const DEBUG_PLUGIN_ROUTING = process.env.DEBUG_PLUGIN_ROUTING === 'true'

async function needsHealing(cachedUrl: string, requestHost: string, kvNamespace: any, githubToken: string): Promise<boolean> {
  try {
    const u = new URL(cachedUrl)
    const expectedDeployment = await getPluginName(requestHost, kvNamespace, githubToken)
    const isHealingNeeded = !u.hostname.startsWith(expectedDeployment)
    if (isHealingNeeded && DEBUG_PLUGIN_ROUTING) {
      console.log(`Healing needed for ${requestHost}: cached target ${u.hostname} does not match expected ${expectedDeployment}`)
    }
    return isHealingNeeded
  } catch {
    return true // If cachedUrl is invalid, it needs healing
  }
}

/**
 * Build plugin Deno URL with route caching optimization
 */
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any, githubToken: string): Promise<string> {
  // Try to get cached route first
  const cachedUrl = await getCachedRoute(kvNamespace, hostname, url.pathname)
  if (cachedUrl) {
    if (await needsHealing(cachedUrl, hostname, kvNamespace, githubToken)) {
      if (DEBUG_PLUGIN_ROUTING) {
        console.log(`[Debug] Stale cache detected for ${hostname}. Recomputing.`)
      }
    } else {
      // Reconstruct URL with current search params (query string might change)
      const cachedUrlObj = new URL(cachedUrl)
      return `${cachedUrlObj.origin}${cachedUrlObj.pathname}${url.search}`
    }
  }

  // Perform plugin name lookup (either no cache or healing needed)
  try {
    const pluginName = await getPluginName(hostname, kvNamespace, githubToken)
    const targetUrl = `https://${pluginName}.deno.dev${url.pathname}${url.search}`

    if (DEBUG_PLUGIN_ROUTING) {
      console.log(`[Debug] Plugin route resolved: rawHost=${hostname}, computedBase=${pluginName}, finalDeployment=${pluginName}.deno.dev, target=${targetUrl}`)
    }

    // Cache the route resolution (without search params for better cache hits)
    const baseTargetUrl = `https://${pluginName}.deno.dev${url.pathname}`
    await cacheRoute(kvNamespace, hostname, url.pathname, baseTargetUrl)

    return targetUrl
  } catch (error) {
    if (DEBUG_PLUGIN_ROUTING) {
      console.log(`[Debug] Plugin routing failed for ${hostname}: ${error}`)
    }
    throw error
  }

}
