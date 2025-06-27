import { getPluginName } from "./get-plugin-name"
import { getCachedRoute, cacheRoute } from "../core/cache"

/**
 * Build plugin Deno URL with route caching optimization
 */
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any, githubToken: string): Promise<string> {
  // Try to get cached route first
  const cachedUrl = await getCachedRoute(kvNamespace, hostname, url.pathname)
  if (cachedUrl) {
    // Reconstruct URL with current search params (query string might change)
    const cachedUrlObj = new URL(cachedUrl)
    return `${cachedUrlObj.origin}${cachedUrlObj.pathname}${url.search}`
  }

  // No cached route, perform expensive plugin name lookup
  const pluginName = await getPluginName(hostname, kvNamespace, githubToken)
  const targetUrl = `https://${pluginName}.deno.dev${url.pathname}${url.search}`

  // Cache the route resolution (without search params for better cache hits)
  const baseTargetUrl = `https://${pluginName}.deno.dev${url.pathname}`
  await cacheRoute(kvNamespace, hostname, url.pathname, baseTargetUrl)

  return targetUrl
}
