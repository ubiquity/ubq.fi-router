import { rateLimitedKVWrite } from './rate-limited-kv-write'
import { kvGetWithFallback } from './kv-fallback-wrapper'

/**
 * Fetch known service subdomains from GitHub API with KV caching
 * Looks for repos in ubiquity org that end with .ubq.fi
 * Returns both service names and metadata for change detection
 */
export async function getKnownServices(kvNamespace: any, githubToken: string): Promise<string[]> {
  const CACHE_KEY = 'github:service-names'
  const METADATA_KEY = 'github:service-metadata'
  const CACHE_TTL = 24 * 60 * 60 // 24 hours

  try {
    // Try to get from cache first
    const cached = await kvGetWithFallback(kvNamespace, CACHE_KEY, { type: 'json' })
    if (cached && Array.isArray(cached)) {
      console.log(`📦 Using cached service names (${cached.length} services)`)
      return cached
    }
  } catch (error) {
    console.warn('Failed to read service cache:', error)
  }

  try {
    console.log('🔍 Fetching service names from GitHub API...')

    if (!githubToken) {
      throw new Error('GITHUB_TOKEN is required but not provided')
    }

    // Fetch from GitHub API with centralized token and timeout
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${githubToken}`,
      'User-Agent': 'ubq.fi-router/1.0'
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

    const repos = await response.json() as Array<{
      name: string
      updated_at: string
      pushed_at: string
    }>

    // Filter for repos that end with .ubq.fi (service domains)
    const serviceRepos = repos.filter((repo) => repo.name.endsWith('.ubq.fi'))

    // Extract subdomain from service repo names and collect metadata
    const serviceData = serviceRepos.map(repo => {
      const subdomain = repo.name === 'ubq.fi' ? '' : repo.name.replace('.ubq.fi', '')
      return {
        subdomain,
        updated_at: repo.updated_at,
        pushed_at: repo.pushed_at
      }
    })

    const serviceSubdomains = serviceData.map(item => item.subdomain)

    console.log(`✅ Fetched ${serviceSubdomains.length} service names from GitHub`)

    // Cache both the service names and metadata for change detection
    try {
      await rateLimitedKVWrite(kvNamespace, CACHE_KEY, JSON.stringify(serviceSubdomains), 'service-discovery', { expirationTtl: CACHE_TTL })
      await rateLimitedKVWrite(kvNamespace, METADATA_KEY, JSON.stringify(serviceData), 'service-discovery', { expirationTtl: CACHE_TTL })
      console.log('💾 Cached service names and metadata')
    } catch (error) {
      console.warn('Failed to cache service names:', error)
    }

    return serviceSubdomains
  } catch (error) {
    console.error('Failed to fetch service names from GitHub:', error)
    throw error
  }
}
