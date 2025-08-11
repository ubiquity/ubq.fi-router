import { isPluginDomain } from "./is-plugin-domain"
import { getKnownPlugins } from "./get-known-plugins"
import { findBasePlugin } from "./find-base-plugin"

const DEBUG_PLUGIN_ROUTING = process.env.DEBUG_PLUGIN_ROUTING === 'true'

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

  const result = `${pluginName}-${branch}`
  
  if (DEBUG_PLUGIN_ROUTING) {
    console.log(`[Debug] Plugin name resolved: rawHost=${hostname}, computedBase=${baseName}, branch=${branch}, finalDeployment=${result}`)
  }
  
  return result
}
