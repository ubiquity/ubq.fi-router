import { isPluginDomain } from "./is-plugin-domain"
import { getKnownPlugins } from "./get-known-plugins"
import { findBasePlugin } from "./find-base-plugin"

/**
 * Get plugin name from hostname
 */
export async function getPluginName(hostname: string, kvNamespace: any, githubToken: string): Promise<string> {
  if (!isPluginDomain(hostname)) {
    throw new Error('Not a plugin domain')
  }

  const fullName = hostname.split('.')[0]

  // Extract base name and branch suffix
  const baseName = fullName.substring(3) // Remove 'os-'
  let pluginName = baseName
  let branch = 'main'

  // Check for development branch suffix
  if (baseName.endsWith('-development')) {
    pluginName = baseName.replace(/-development$/, '')
    branch = 'development'
  }

  try {
    const knownPlugins = await getKnownPlugins(kvNamespace, githubToken)

    // Return plugin name with branch suffix
    return `${pluginName}-${branch}`
  } catch (error) {
    console.error('Error in getPluginName:', error)
    throw error
  }
}
