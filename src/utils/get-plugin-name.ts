import { isPluginDomain } from "./is-plugin-domain"
import { getKnownPlugins } from "./get-known-plugins"
import { findBasePlugin } from "./find-base-plugin"

/**
 * Get plugin name from hostname
 */
export async function getPluginName(hostname: string, kvNamespace: any): Promise<string> {
  if (!isPluginDomain(hostname)) {
    throw new Error('Not a plugin domain')
  }

  const withoutPrefix = hostname.split('.')[0].substring(3) // Remove 'os-'

  try {
    const knownPlugins = await getKnownPlugins(kvNamespace)

    // Check if it's an exact match
    if (knownPlugins.includes(withoutPrefix)) {
      return `${withoutPrefix}-main`
    }

    // Try to find base plugin
    const basePlugin = findBasePlugin(withoutPrefix, knownPlugins)
    if (basePlugin) {
      return withoutPrefix // Use the full subdomain name
    }

    throw new Error(`Unknown plugin: ${withoutPrefix}`)
  } catch (error) {
    console.error('Error in getPluginName:', error)
    throw error
  }
}