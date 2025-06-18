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
  let pluginName: string
  let branch: string

  // Check for explicit branch suffixes
  if (baseName.endsWith('-development')) {
    pluginName = baseName.replace(/-development$/, '')
    branch = 'development'
  } else if (baseName.endsWith('-dev')) {
    // Handle -dev alias for development
    pluginName = baseName.replace(/-dev$/, '')
    branch = 'development'
  } else if (baseName.endsWith('-main')) {
    // Handle explicit -main suffix
    pluginName = baseName.replace(/-main$/, '')
    branch = 'main'
  } else {
    // No suffix = production alias (append -main)
    pluginName = baseName
    branch = 'main'
  }

  // Return plugin name with branch suffix - no GitHub API validation required
  // The actual validation happens when checking the manifest endpoint
  return `${pluginName}-${branch}`
}
