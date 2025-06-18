import { getPluginName } from "./get-plugin-name"

/**
 * Build plugin Pages URL
 */
export async function buildPluginPagesUrl(hostname: string, url: URL, kvNamespace: any): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace)
  return `https://${pluginName}.pages.dev${url.pathname}${url.search}`
}