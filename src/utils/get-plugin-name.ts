import { isPluginDomain } from "./is-plugin-domain"

/**
 * Get plugin name from hostname
 */
export function getPluginName(hostname: string): string {
  if (!isPluginDomain(hostname)) {
    throw new Error('Not a plugin domain')
  }

  const fullName = hostname.split('.')[0]
  const baseName = fullName.substring(3) // remove 'os-'

  if (baseName.endsWith('-development')) {
    return baseName // already suffixed
  } else if (baseName.endsWith('-dev')) {
    return `${baseName.replace(/-dev$/, '')}-development`
  } else if (baseName.endsWith('-main')) {
    return baseName
  }
  // No suffix = production alias
  return `${baseName}-main`
}
