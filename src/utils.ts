/**
 * Extract subdomain key for caching
 * Examples:
 * - ubq.fi -> ""
 * - pay.ubq.fi -> "pay"
 * - beta.pay.ubq.fi -> "beta.pay"
 * - os-command-config-main.ubq.fi -> "os-command-config-main"
 */
export function getSubdomainKey(hostname: string): string {
  const parts = hostname.split('.')

  if (parts.length === 2) {
    // Root domain: ubq.fi
    return ""
  } else if (parts.length === 3) {
    // Standard subdomain: pay.ubq.fi or plugin domain: os-*.ubq.fi
    return parts[0]
  } else if (parts.length === 4) {
    // Branch subdomain: beta.pay.ubq.fi
    return `${parts[0]}.${parts[1]}`
  }

  throw new Error('Invalid domain format')
}

/**
 * Check if a hostname is a plugin domain (os-*.ubq.fi)
 */
export function isPluginDomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length === 3 && parts[0].startsWith('os-') && parts[1] === 'ubq' && parts[2] === 'fi'
}

/**
 * Fetch known plugin names from GitHub API with KV caching
 */
async function getKnownPlugins(kvNamespace: any): Promise<string[]> {
  const CACHE_KEY = 'github:plugin-names'
  const CACHE_TTL = 24 * 60 * 60 // 24 hours

  try {
    // Try to get from cache first
    const cached = await kvNamespace.get(CACHE_KEY, { type: 'json' })
    if (cached && Array.isArray(cached)) {
      return cached
    }
  } catch (error) {
    console.warn('Failed to read plugin cache:', error)
  }

  try {
    // Fetch from GitHub API
    const response = await fetch('https://api.github.com/orgs/ubiquity-os-marketplace/repos?per_page=100')
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const repos = await response.json() as Array<{ name: string }>
    const pluginNames = repos.map((repo) => repo.name).filter((name: string) => name)

    // Cache the results
    try {
      await kvNamespace.put(CACHE_KEY, JSON.stringify(pluginNames), { expirationTtl: CACHE_TTL })
    } catch (error) {
      console.warn('Failed to cache plugin names:', error)
    }

    return pluginNames
  } catch (error) {
    console.error('Failed to fetch plugin names from GitHub:', error)
    throw new Error(`GitHub API failed: ${error}`)
  }
}

/**
 * Find the base plugin name from a potentially suffixed name
 */
function findBasePlugin(withoutPrefix: string, knownPlugins: string[]): string | null {
  // First check if it's an exact match
  if (knownPlugins.includes(withoutPrefix)) {
    return withoutPrefix
  }

  // Try to find base plugin by removing potential suffixes
  const parts = withoutPrefix.split('-')

  // Try removing one segment at a time from the end
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('-')
    if (knownPlugins.includes(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Extract plugin name from plugin domain with GitHub API validation
 * Examples:
 * - os-command-config-main.ubq.fi -> "command-config-main"
 * - os-command-config.ubq.fi -> "command-config-main" (production alias)
 * - os-command-config-dev.ubq.fi -> "command-config-dev"
 * - os-text-conversation-rewards.ubq.fi -> "text-conversation-rewards-main"
 * - os-text-conversation-rewards-pr-123.ubq.fi -> "text-conversation-rewards-pr-123"
 */
export async function getPluginName(hostname: string, kvNamespace: any): Promise<string> {
  if (!isPluginDomain(hostname)) {
    throw new Error('Not a plugin domain')
  }

  const withoutPrefix = hostname.split('.')[0].substring(3)

  try {
    // Get known plugins from GitHub API (cached)
    const knownPlugins = await getKnownPlugins(kvNamespace)

    // Check if exact match (base plugin name)
    if (knownPlugins.includes(withoutPrefix)) {
      return `${withoutPrefix}-main`
    }

    // Check if has valid plugin prefix
    const basePlugin = findBasePlugin(withoutPrefix, knownPlugins)
    if (basePlugin) {
      return withoutPrefix // use as-is (has suffix)
    }

    // Unknown plugin - fail explicitly
    throw new Error(`Unknown plugin: ${withoutPrefix}`)
  } catch (error) {
    console.error('Error in getPluginName:', error)
    throw error
  }
}

/**
 * Build Deno Deploy URL from subdomain pattern
 */
export function buildDenoUrl(subdomain: string, url: URL): string {
  if (subdomain === "") {
    // Root domain: ubq.fi -> ubq-fi.deno.dev
    return `https://ubq-fi.deno.dev${url.pathname}${url.search}`
  } else {
    // Subdomain: pay.ubq.fi -> pay-ubq-fi.deno.dev
    // Branch: beta.pay.ubq.fi -> beta-pay-ubq-fi.deno.dev
    const denoSubdomain = subdomain.replace(/\./g, '-')
    return `https://${denoSubdomain}-ubq-fi.deno.dev${url.pathname}${url.search}`
  }
}

/**
 * Build Cloudflare Pages URL from subdomain pattern
 */
export function buildPagesUrl(subdomain: string, url: URL): string {
  if (subdomain === "") {
    // Root domain: ubq.fi -> ubq-fi.pages.dev
    return `https://ubq-fi.pages.dev${url.pathname}${url.search}`
  } else {
    // Subdomain: pay.ubq.fi -> pay-ubq-fi.pages.dev
    // Branch: beta.pay.ubq.fi -> beta.pay-ubq-fi.pages.dev
    return `https://${subdomain}-ubq-fi.pages.dev${url.pathname}${url.search}`
  }
}

/**
 * Build plugin URL from plugin domain (Deno Deploy)
 * Example: os-command-config-main.ubq.fi -> https://command-config-main.deno.dev
 */
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace)
  return `https://${pluginName}.deno.dev${url.pathname}${url.search}`
}

/**
 * Build plugin URL from plugin domain (Cloudflare Pages)
 * Example: os-command-config-main.ubq.fi -> https://command-config-main.pages.dev
 */
export async function buildPluginPagesUrl(hostname: string, url: URL, kvNamespace: any): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace)
  return `https://${pluginName}.pages.dev${url.pathname}${url.search}`
}
