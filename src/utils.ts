import { GITHUB_TOKEN } from "./env"

/**
 * Extract subdomain key from hostname
 * ubq.fi -> ""
 * pay.ubq.fi -> "pay"
 */
export function getSubdomainKey(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length === 2) {
    return '' // ubq.fi
  } else if (parts.length === 3) {
    return parts[0] // pay.ubq.fi -> pay
  }
  throw new Error('Invalid domain format')
}

/**
 * Check if hostname is a plugin domain (os-*.ubq.fi)
 */
export function isPluginDomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length === 3 && parts[0].startsWith('os-') && parts[1] === 'ubq' && parts[2] === 'fi'
}

/**
 * Fetch known plugin names from GitHub API with KV caching
 */
export async function getKnownPlugins(kvNamespace: any): Promise<string[]> {
  const CACHE_KEY = 'github:plugin-names'
  const CACHE_TTL = 24 * 60 * 60 // 24 hours

  try {
    // Try to get from cache first
    const cached = await kvNamespace.get(CACHE_KEY, { type: 'json' })
    if (cached && Array.isArray(cached)) {
      console.log(`📦 Using cached plugin names (${cached.length} plugins)`)
      return cached
    }
  } catch (error) {
    console.warn('Failed to read plugin cache:', error)
  }

  try {
    console.log('🔍 Fetching plugin names from GitHub API...')

    // Fetch from GitHub API with centralized token and timeout
    const headers: Record<string, string> = {
      'Authorization': `token ${GITHUB_TOKEN}`
    }
    console.log('🔑 Using GitHub token for API request')

    const response = await fetch('https://api.github.com/orgs/ubiquity-os-marketplace/repos?per_page=100', {
      headers,
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })

    if (!response.ok) {
      const remaining = response.headers.get('X-RateLimit-Remaining')
      const resetTime = response.headers.get('X-RateLimit-Reset')
      const errorMessage = `GitHub API error: ${response.status} ${response.statusText}`

      if (remaining && resetTime) {
        throw new Error(`${errorMessage} - Rate limit: ${remaining} remaining, resets at ${new Date(parseInt(resetTime) * 1000)}`)
      }

      throw new Error(errorMessage)
    }

    const repos = await response.json() as Array<{ name: string }>
    const pluginNames = repos.map((repo) => repo.name).filter((name: string) => name)

    console.log(`✅ Fetched ${pluginNames.length} plugin names from GitHub`)

    // Cache the results
    try {
      await kvNamespace.put(CACHE_KEY, JSON.stringify(pluginNames), { expirationTtl: CACHE_TTL })
      console.log('💾 Cached plugin names')
    } catch (error) {
      console.warn('Failed to cache plugin names:', error)
    }

    return pluginNames
  } catch (error) {
    console.error('Failed to fetch plugin names from GitHub:', error)
    throw error
  }
}

/**
 * Fetch known service subdomains from GitHub API with KV caching
 * Looks for repos in ubiquity org that end with .ubq.fi
 */
export async function getKnownServices(kvNamespace: any): Promise<string[]> {
  const CACHE_KEY = 'github:service-names'
  const CACHE_TTL = 24 * 60 * 60 // 24 hours

  try {
    // Try to get from cache first
    const cached = await kvNamespace.get(CACHE_KEY, { type: 'json' })
    if (cached && Array.isArray(cached)) {
      console.log(`📦 Using cached service names (${cached.length} services)`)
      return cached
    }
  } catch (error) {
    console.warn('Failed to read service cache:', error)
  }

  try {
    console.log('🔍 Fetching service names from GitHub API...')

    // Fetch from GitHub API with centralized token and timeout
    const headers: Record<string, string> = {
      'Authorization': `token ${GITHUB_TOKEN}`
    }
    console.log('🔑 Using GitHub token for services API request')

    const response = await fetch('https://api.github.com/orgs/ubiquity/repos?per_page=100', {
      headers,
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })

    if (!response.ok) {
      const remaining = response.headers.get('X-RateLimit-Remaining')
      const resetTime = response.headers.get('X-RateLimit-Reset')
      const errorMessage = `GitHub API error for services: ${response.status} ${response.statusText}`

      if (remaining && resetTime) {
        throw new Error(`${errorMessage} - Rate limit: ${remaining} remaining, resets at ${new Date(parseInt(resetTime) * 1000)}`)
      }

      throw new Error(errorMessage)
    }

    const repos = await response.json() as Array<{ name: string }>

    // Filter for repos that end with .ubq.fi (service domains)
    const serviceRepos = repos
      .map((repo) => repo.name)
      .filter((name: string) => name.endsWith('.ubq.fi'))

    // Extract subdomain from service repo names
    // e.g., "pay.ubq.fi" -> "pay", "ubq.fi" -> ""
    const serviceSubdomains = serviceRepos.map(name => {
      if (name === 'ubq.fi') return ''
      return name.replace('.ubq.fi', '')
    })

    console.log(`✅ Fetched ${serviceSubdomains.length} service names from GitHub`)

    // Cache the results
    try {
      await kvNamespace.put(CACHE_KEY, JSON.stringify(serviceSubdomains), { expirationTtl: CACHE_TTL })
      console.log('💾 Cached service names')
    } catch (error) {
      console.warn('Failed to cache service names:', error)
    }

    return serviceSubdomains
  } catch (error) {
    console.error('Failed to fetch service names from GitHub:', error)
    throw error
  }
}

/**
 * Find base plugin name from plugin domain
 */
function findBasePlugin(withoutPrefix: string, knownPlugins: string[]): string | null {
  // Check if it's an exact match first
  if (knownPlugins.includes(withoutPrefix)) {
    return withoutPrefix
  }

  // Try removing suffixes progressively
  const parts = withoutPrefix.split('-')
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('-')
    if (knownPlugins.includes(candidate)) {
      return candidate
    }
  }

  return null
}

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

/**
 * Build Deno deployment URL
 */
export function buildDenoUrl(subdomain: string, url: URL): string {
  if (subdomain === '') {
    return `https://ubq-fi.deno.dev${url.pathname}${url.search}`
  } else {
    return `https://${subdomain}-ubq-fi.deno.dev${url.pathname}${url.search}`
  }
}

/**
 * Build Pages deployment URL
 */
export function buildPagesUrl(subdomain: string, url: URL): string {
  if (subdomain === '') {
    return `https://ubq-fi.pages.dev${url.pathname}${url.search}`
  } else {
    return `https://${subdomain}-ubq-fi.pages.dev${url.pathname}${url.search}`
  }
}

/**
 * Build plugin Deno URL
 */
export async function buildPluginUrl(hostname: string, url: URL, kvNamespace: any): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace)
  return `https://${pluginName}.deno.dev${url.pathname}${url.search}`
}

/**
 * Build plugin Pages URL
 */
export async function buildPluginPagesUrl(hostname: string, url: URL, kvNamespace: any): Promise<string> {
  const pluginName = await getPluginName(hostname, kvNamespace)
  return `https://${pluginName}.pages.dev${url.pathname}${url.search}`
}
