import { getPluginName } from "./get-plugin-name.ts"
import { getCachedRoute, cacheRoute, clearFromCache, CACHE_CONFIGS } from "../core/cache.ts"

async function needsHealing(cachedUrl: string, requestHost: string, kvNamespace: any, githubToken: string, debugRouting: boolean): Promise<boolean> {
  try {
    const u = new URL(cachedUrl)
    const expectedDeployment = await getPluginName(requestHost, kvNamespace, githubToken, debugRouting)
    const isHealingNeeded = !u.hostname.startsWith(expectedDeployment)
    if (isHealingNeeded && debugRouting) {
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
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any, githubToken: string, debugRouting: boolean): Promise<string> {
  // Try to get cached route first
  const cachedUrl = await getCachedRoute(kvNamespace, hostname, url.pathname)
  console.log(`[CACHE DEBUG] Got cached URL for ${hostname}${url.pathname}: ${cachedUrl}`)
  
  if (cachedUrl) {
    const healingNeeded = await needsHealing(cachedUrl, hostname, kvNamespace, githubToken, debugRouting)
    console.log(`[CACHE DEBUG] Healing needed for ${hostname}: ${healingNeeded}`)
    
    if (healingNeeded) {
      console.log(`[CACHE DEBUG] Stale cache detected for ${hostname}. Clearing cache entry and recomputing.`)
      await clearFromCache(kvNamespace, `${hostname}${url.pathname}`, CACHE_CONFIGS.ROUTES)
      console.log(`[CACHE DEBUG] Stale cache entry cleared for ${hostname}${url.pathname}`)
    } else {
      // Reconstruct URL with current search params (query string might change)
      const cachedUrlObj = new URL(cachedUrl)
      return `${cachedUrlObj.origin}${cachedUrlObj.pathname}${url.search}`
    }
  }

  // Perform plugin name lookup (either no cache or healing needed)
  try {
    const pluginName = await getPluginName(hostname, kvNamespace, githubToken, debugRouting)
    const targetUrl = `https://${pluginName}.deno.dev${url.pathname}${url.search}`
    console.log(`[CACHE DEBUG] Generated fresh URL: ${targetUrl}`)

    if (debugRouting) {
      console.log(`[Debug] Plugin route resolved: rawHost=${hostname}, computedBase=${pluginName}, finalDeployment=${pluginName}.deno.dev, target=${targetUrl}`)
    }

    // Cache the route resolution (without search params for better cache hits)
    const baseTargetUrl = `https://${pluginName}.deno.dev${url.pathname}`
    console.log(`[CACHE DEBUG] About to cache: ${hostname}${url.pathname} -> ${baseTargetUrl}`)
    await cacheRoute(kvNamespace, hostname, url.pathname, baseTargetUrl)
    console.log(`[CACHE DEBUG] Cache update completed`)

    return targetUrl
  } catch (error) {
    if (debugRouting) {
      console.log(`[Debug] Plugin routing failed for ${hostname}: ${error}`)
    }
    throw error
  }

}