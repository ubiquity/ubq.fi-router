/**
 * Aggressive cache management with write reduction optimizations
 * No defensive coding, explicit failures only
 */

import { trackKVWrite } from '../analytics/write-tracker'
import { kvGetWithFallback, kvPutWithFallback, kvDeleteWithFallback, kvListWithFallback } from '../utils/kv-fallback-wrapper'
import { routeResolutionCache } from './memory-cache'

export interface CacheConfig {
  ttlHours: number
  prefix: string
}

/**
 * Get from cache - KV only (no in-memory state in workers)
 */
export async function getFromCache<T>(
  kvNamespace: any,
  key: string,
  config: CacheConfig
): Promise<T | null> {
  const fullKey = `${config.prefix}:${key}`

  try {
    const cached = await kvGetWithFallback(kvNamespace, fullKey, { type: 'json' })
    if (cached !== null) {
      return cached as T
    }
    return null
  } catch (error) {
    console.warn(`Cache read failed for key ${fullKey}: ${(error as Error).message}`)
    return null // Return null instead of crashing when KV is down
  }
}

/**
 * Put to cache with aggressive write reduction and KV fallback protection
 */
export async function putToCache<T>(
  kvNamespace: any,
  key: string,
  value: T,
  config: CacheConfig,
  request?: any
): Promise<void> {
  const fullKey = `${config.prefix}:${key}`
  const ttlSeconds = config.ttlHours * 60 * 60

  try {
    // Read-before-write optimization to prevent duplicate writes
    const existingValue = await kvGetWithFallback(kvNamespace, fullKey)
    const newValue = JSON.stringify(value)

    if (existingValue === newValue) {
      console.log(`KV write skipped for key '${fullKey}', content unchanged.`)
      return; // Skip the write
    }

    // Perform the KV write with fallback protection
    const kvWriteSuccess = await kvPutWithFallback(kvNamespace, fullKey, newValue, {
      expirationTtl: ttlSeconds
    })

    console.log(`KV write ${kvWriteSuccess ? 'completed' : 'fell back (KV locked)'} for key '${fullKey}'.`)

  } catch (error) {
    // Don't crash when KV write fails - service should continue
    console.error(`Cache write failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Clear cache entry from KV with fallback protection
 */
export async function clearFromCache(
  kvNamespace: any,
  key: string,
  config: CacheConfig
): Promise<void> {
  const fullKey = `${config.prefix}:${key}`

  try {
    const kvDeleteSuccess = await kvDeleteWithFallback(kvNamespace, fullKey)
    console.log(`Cache cleared for key '${fullKey}' (${kvDeleteSuccess ? 'success' : 'KV locked'}).`)
  } catch (error) {
    console.error(`Cache delete failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Clear all cache entries with prefix from KV with fallback protection
 */
export async function clearAllCache(
  kvNamespace: any,
  config: CacheConfig
): Promise<number> {
  try {
    const prefix = `${config.prefix}:`
    const list = await kvListWithFallback(kvNamespace, { prefix })

    const deletePromises = list.keys.map((item: any) =>
      kvDeleteWithFallback(kvNamespace, item.name)
    )

    const deleteResults = await Promise.all(deletePromises)
    const kvDeletedCount = deleteResults.filter(success => success).length

    console.log(`Cache clear-all completed: ${kvDeletedCount}/${list.keys.length} KV entries for prefix '${config.prefix}'.`)
    return list.keys.length
  } catch (error) {
    console.error(`Cache clear-all failed for prefix ${config.prefix}: ${(error as Error).message}`)
    return 0
  }
}

/**
 * Cache configurations - DRAMATICALLY INCREASED TTLs
 */
export const CACHE_CONFIGS = {
  SITEMAP: { ttlHours: 168, prefix: 'sitemap' }, // 7 days (was 6 hours)
  PLUGIN_MAP: { ttlHours: 168, prefix: 'plugin-map' }, // 7 days (was 2 hours)
  ROUTES: { ttlHours: 24, prefix: 'route' } // 24 hours (was 1 hour)
} as const

/**
 * Route resolution cache for expensive plugin URL lookups
 */
export interface RouteResolution {
  targetUrl: string
  cached_at: string
}

/**
 * Generate route cache key from hostname and pathname
 */
export function generateRouteCacheKey(hostname: string, pathname: string): string {
  const normalizedHostname = hostname.toLowerCase()
  const normalizedPath = pathname || '/'
  return `${normalizedHostname}${normalizedPath}`
}

/**
 * Get cached route resolution for plugin URLs
 */
export async function getCachedRoute(
  kvNamespace: any,
  hostname: string,
  pathname: string
): Promise<string | null> {
  const key = generateRouteCacheKey(hostname, pathname)

  try {
    // In-memory first
    const mem = routeResolutionCache.get(key)
    if (mem) {
      return mem
    }

    const cached = await getFromCache<RouteResolution>(kvNamespace, key, CACHE_CONFIGS.ROUTES)
    if (cached?.targetUrl) {
      console.log(`📦 Using cached route for '${hostname}${pathname}' -> '${cached.targetUrl}'`)
      routeResolutionCache.set(key, cached.targetUrl)
      return cached.targetUrl
    }
    return null
  } catch (error) {
    console.warn(`Failed to get cached route for '${hostname}${pathname}':`, error)
    return null
  }
}

/**
 * Cache successful route resolution for plugin URLs
 */
export async function cacheRoute(
  kvNamespace: any,
  hostname: string,
  pathname: string,
  targetUrl: string
): Promise<void> {
  const key = generateRouteCacheKey(hostname, pathname)

  try {
    const resolution: RouteResolution = {
      targetUrl,
      cached_at: new Date().toISOString()
    }

    await putToCache(kvNamespace, key, resolution, CACHE_CONFIGS.ROUTES)
    // Update in-memory too
    routeResolutionCache.set(key, targetUrl)
    console.log(`💾 Cached route for '${hostname}${pathname}' -> '${targetUrl}'`)
  } catch (error) {
    console.warn(`Failed to cache route for '${hostname}${pathname}':`, error)
    // Don't throw - caching failure shouldn't break routing
  }
}
