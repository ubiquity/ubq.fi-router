import { getPluginName } from "./get-plugin-name"

/**
 * Build plugin Deno URL with route caching optimization
 */
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any, githubToken: string): Promise<string> {
  // Resolve plugin name from hostname (no KV I/O)
  const pluginName = await getPluginName(hostname, kvNamespace, githubToken)
  return `https://${pluginName}.deno.dev${url.pathname}${url.search}`
}
