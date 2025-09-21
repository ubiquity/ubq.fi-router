import { getPluginName } from "./get-plugin-name"

/**
 * Build plugin Pages URL with route caching optimization
 */
export async function buildPluginPagesUrl(hostname: string, url: URL, kvNamespace: any, githubToken: string): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace, githubToken)
  return `https://${pluginName}.pages.dev${url.pathname}${url.search}`
}
