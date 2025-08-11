import { isPluginDomain } from "./is-plugin-domain.ts"

export async function getPluginName(hostname: string, kvNamespace: any, githubToken: string, debugRouting: boolean): Promise<string> {
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
    // Check if this has a recognized branch suffix
    const knownBranches = ['demo', 'staging', 'test', 'main']
    const dashIndex = baseName.lastIndexOf('-')
    if (dashIndex === -1) {
      // No branch suffix = production alias (append -main)
      pluginName = baseName
      branch = 'main'
    } else {
      const potentialBranch = baseName.substring(dashIndex + 1)
      const pluginNamePart = baseName.substring(0, dashIndex)
      
      // Special handling: if potential branch is "demo" but the plugin part is too short,
      // treat "demo" as part of plugin name instead of branch
      if (potentialBranch === 'demo' && pluginNamePart.length <= 7) {
        pluginName = baseName
        branch = 'main'
      } else if (knownBranches.includes(potentialBranch)) {
        // Recognized branch suffix
        pluginName = pluginNamePart
        branch = potentialBranch
      } else {
        // Not a recognized branch - treat entire baseName as plugin name
        pluginName = baseName
        branch = 'main'
      }
    }
  }

  const result = `${pluginName}-${branch}`

  if (debugRouting) {
    console.log(`[Debug] Plugin name resolved: rawHost=${hostname}, computedBase=${baseName}, branch=${branch}, finalDeployment=${result}`)
  }

  return result
}