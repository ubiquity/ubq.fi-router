import { getPluginName } from "./get-plugin-name"

/**
 * Build plugin Deno URL
 */
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace)
  return `https://${pluginName}.deno.dev${url.pathname}${url.search}`
}