/**
 * Fetch known plugin names from GitHub API with KV caching
 */
export async function getKnownPlugins(kvNamespace: any, githubToken: string): Promise<string[]> {
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

    if (!githubToken) {
      throw new Error('GITHUB_TOKEN is required but not provided')
    }

    // Fetch from GitHub API with centralized token and timeout
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${githubToken}`,
      'User-Agent': 'ubq.fi-router/1.0'
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
