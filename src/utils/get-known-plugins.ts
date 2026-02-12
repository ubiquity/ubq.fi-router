/**
 * Fetch known plugin names from GitHub API with in-memory caching
 * Falls back to static config when GitHub API is unavailable
 */
import { memoryGet, memoryPut } from './memory-cache'
import { getPluginNames } from './static-config'

const CACHE_KEY = 'github:plugin-names'
const CACHE_TTL = 24 * 60 * 60 // 24 hours

/**
 * Fetch plugin names from GitHub API
 */
async function fetchFromGitHub(githubToken: string): Promise<string[]> {

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${githubToken}`,
    'User-Agent': 'ubq.fi-router/1.0'
  }

  const response = await fetch('https://api.github.com/orgs/ubiquity-os-marketplace/repos?per_page=100', {
    headers,
    signal: AbortSignal.timeout(5000) // 5 second timeout
  })

  if (!response.ok) {
    const remaining = response.headers.get('X-RateLimit-Remaining')
    const resetTime = response.headers.get('X-RateLimit-Reset')
    const errorMessage = `GitHub API error for plugins: ${response.status} ${response.statusText}`

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


  // Extract plugin names
  const pluginNames = repos.map(repo => repo.name)

  return pluginNames
}

/**
 * Get known plugin names
 * Uses in-memory cache first, then GitHub API, then static fallback
 */
export async function getKnownPlugins(githubToken?: string): Promise<string[]> {
  // Try in-memory cache first
  const cached = await memoryGet(CACHE_KEY)
  if (cached) {
    return JSON.parse(cached)
  }

  // Try GitHub API if token provided
  if (githubToken) {
    try {
      const plugins = await fetchFromGitHub(githubToken)
      await memoryPut(CACHE_KEY, JSON.stringify(plugins), CACHE_TTL)
      return plugins
    } catch (error) {
      console.warn('GitHub API failed, using static fallback:', error instanceof Error ? error.message : error)
    }
  }

  // Fallback to static list
  const staticPlugins = getPluginNames()
  return staticPlugins
}
