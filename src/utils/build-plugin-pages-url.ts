import { getPluginName } from "./get-plugin-name.ts"
import { getCachedRoute, cacheRoute } from "../core/cache.ts"

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
 * Build plugin Pages URL with route caching optimization
 */
export async function buildPluginPagesUrl(hostname: string, url: URL, kvNamespace: any, githubToken: string, debugRouting: boolean): Promise<string> {
  // Create a unique cache key for Pages routes (different from Deno routes)
  const pagesCacheKey = `pages:${url.pathname}`

  // Try to get cached route first
  const cachedUrl = await getCachedRoute(kvNamespace, hostname, pagesCacheKey)
  if (cachedUrl) {
    if (await needsHealing(cachedUrl, hostname, kvNamespace, githubToken, debugRouting)) {
      if (debugRouting) {
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
    const pluginName = await getPluginName(hostname, kvNamespace, githubToken, debugRouting)
    const targetUrl = `https://${pluginName}.pages.dev${url.pathname}${url.search}`

    if (debugRouting) {
      console.log(`[Debug] Plugin pages route resolved: rawHost=${hostname}, computedBase=${pluginName}, finalDeployment=${pluginName}.pages.dev, target=${targetUrl}`)
    }

    // Cache the route resolution (without search params for better cache hits)
    const baseTargetUrl = `https://${pluginName}.pages.dev${url.pathname}`
    await cacheRoute(kvNamespace, hostname, pagesCacheKey, baseTargetUrl)

    return targetUrl
  } catch (error) {
    if (debugRouting) {
      console.log(`[Debug] Plugin pages routing failed for ${hostname}: ${error}`)
    }
    throw error
  }
}