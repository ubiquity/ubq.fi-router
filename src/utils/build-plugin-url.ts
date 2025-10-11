import { getPluginName } from "./get-plugin-name"

/**
 * Build plugin Deno URL with route caching optimization
 */
export function buildPluginUrl(hostname: string, url: URL): string {
  // Resolve plugin name from hostname deterministically (no KV/GitHub)
  const pluginName = getPluginName(hostname)
  return `https://${pluginName}.deno.dev${url.pathname}${url.search}`
}
