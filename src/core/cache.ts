/**
 * Aggressive cache management with write reduction optimizations
 * No defensive coding, explicit failures only
 */

export interface CacheConfig {
  ttlHours: number
  prefix: string
}

// In-memory cache for hot data to reduce KV reads/writes
const memoryCache = new Map<string, { value: any; expires: number; hash: string }>()
const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes in memory

/**
 * Generate content hash for change detection
 */
function generateHash(value: any): string {
  return btoa(JSON.stringify(value)).slice(0, 16)
}

/**
 * Clean expired memory cache entries
 */
function cleanMemoryCache(): void {
  const now = Date.now()
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expires < now) {
      memoryCache.delete(key)
    }
  }
}

/**
 * Get from memory cache first, then KV
 */
async function getFromMemoryOrKv<T>(
  kvNamespace: any,
  fullKey: string
): Promise<T | null> {
  // Check memory cache first
  const memEntry = memoryCache.get(fullKey)
  if (memEntry && memEntry.expires > Date.now()) {
    return memEntry.value as T
  }

  // Fallback to KV
  try {
    const cached = await kvNamespace.get(fullKey, { type: 'json' })
    if (cached !== null) {
      // Store in memory cache for faster future access
      const hash = generateHash(cached)
      memoryCache.set(fullKey, {
        value: cached,
        expires: Date.now() + MEMORY_CACHE_TTL_MS,
        hash
      })
      return cached as T
    }
    return null
  } catch (error) {
    throw new Error(`Cache read failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Get from cache - Memory first, then KV - CRASH if corrupt
 */
export async function getFromCache<T>(
  kvNamespace: any,
  key: string,
  config: CacheConfig
): Promise<T | null> {
  const fullKey = `${config.prefix}:${key}`

  // Clean expired entries periodically
  if (Math.random() < 0.01) {
    cleanMemoryCache()
  }

  const cached = await getFromMemoryOrKv<T>(kvNamespace, fullKey)

  if (cached === null) {
    return null
  }

  // CRASH if cache is corrupt/unexpected type
  if (typeof cached !== 'object') {
    throw new Error(`Cache corruption: expected object but got ${typeof cached} for key ${fullKey}`)
  }

  return cached as T
}

/**
 * Put to cache with aggressive write reduction - CRASH if write fails
 */
export async function putToCache<T>(
  kvNamespace: any,
  key: string,
  value: T,
  config: CacheConfig,
  // This is a diagnostic parameter, not for general use
  // It is used to pass the request object for logging purposes
  request?: any
): Promise<void> {
  const fullKey = `${config.prefix}:${key}`
  const ttlSeconds = config.ttlHours * 60 * 60
  const newHash = generateHash(value)

  try {
    // Check memory cache first for hash comparison
    const memEntry = memoryCache.get(fullKey)
    if (memEntry && memEntry.hash === newHash) {
      if (request) {
        const logEntry = {
          level: "INFO",
          message: `KV write skipped for key '${fullKey}', content unchanged (memory cache).`,
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
        };
        console.log(JSON.stringify(logEntry, null, 2));
      } else {
        console.log(`KV write skipped for key '${fullKey}', content unchanged (memory cache).`);
      }
      return; // Skip the write
    }

    // Fallback to KV read-before-write optimization
    const existingValue = await kvNamespace.get(fullKey)
    const newValue = JSON.stringify(value)

    if (existingValue === newValue) {
      if (request) {
        const logEntry = {
          level: "INFO",
          message: `KV write skipped for key '${fullKey}', content unchanged (KV cache).`,
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers),
        };
        console.log(JSON.stringify(logEntry, null, 2));
      } else {
        console.log(`KV write skipped for key '${fullKey}', content unchanged (KV cache).`);
      }

      // Update memory cache even if we didn't write to KV
      memoryCache.set(fullKey, {
        value: value,
        expires: Date.now() + MEMORY_CACHE_TTL_MS,
        hash: newHash
      })
      return; // Skip the write
    }

    // Perform the KV write
    await kvNamespace.put(fullKey, newValue, {
      expirationTtl: ttlSeconds
    })

    // Update memory cache after successful KV write
    memoryCache.set(fullKey, {
      value: value,
      expires: Date.now() + MEMORY_CACHE_TTL_MS,
      hash: newHash
    })

    if (request) {
      const logEntry = {
        level: "INFO",
        message: `KV write completed for key '${fullKey}'.`,
        url: request.url,
        method: request.method,
      };
      console.log(JSON.stringify(logEntry, null, 2));
    } else {
      console.log(`KV write completed for key '${fullKey}'.`);
    }

  } catch (error) {
    // CRASH if cache write fails
    throw new Error(`Cache write failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Clear cache entry from both memory and KV - CRASH if delete fails
 */
export async function clearFromCache(
  kvNamespace: any,
  key: string,
  config: CacheConfig
): Promise<void> {
  const fullKey = `${config.prefix}:${key}`

  try {
    // Clear from memory cache first
    memoryCache.delete(fullKey)

    // Clear from KV
    await kvNamespace.delete(fullKey)

    console.log(`Cache cleared for key '${fullKey}' (both memory and KV).`)
  } catch (error) {
    throw new Error(`Cache delete failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Clear all cache entries with prefix from both memory and KV - CRASH if any delete fails
 */
export async function clearAllCache(
  kvNamespace: any,
  config: CacheConfig
): Promise<number> {
  try {
    // Clear from memory cache first
    const memoryPrefix = `${config.prefix}:`
    let memoryClearedCount = 0
    for (const [key] of memoryCache.entries()) {
      if (key.startsWith(memoryPrefix)) {
        memoryCache.delete(key)
        memoryClearedCount++
      }
    }

    // Clear from KV
    const list = await kvNamespace.list({ prefix: memoryPrefix })
    const deletePromises = list.keys.map((item: any) =>
      kvNamespace.delete(item.name)
    )

    await Promise.all(deletePromises)

    console.log(`Cache clear-all completed: ${memoryClearedCount} memory entries, ${list.keys.length} KV entries for prefix '${config.prefix}'.`)
    return list.keys.length
  } catch (error) {
    throw new Error(`Cache clear-all failed for prefix ${config.prefix}: ${(error as Error).message}`)
  }
}

/**
 * Cache configurations
 */
export const CACHE_CONFIGS = {
  SITEMAP: { ttlHours: 6, prefix: 'sitemap' },
  PLUGIN_MAP: { ttlHours: 2, prefix: 'plugin-map' },
  ROUTES: { ttlHours: 1, prefix: 'route' }
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
  // Normalize and sanitize the key
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
    const cached = await getFromCache<RouteResolution>(kvNamespace, key, CACHE_CONFIGS.ROUTES)
    if (cached?.targetUrl) {
      console.log(`📦 Using cached route for '${hostname}${pathname}' -> '${cached.targetUrl}'`)
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
    console.log(`💾 Cached route for '${hostname}${pathname}' -> '${targetUrl}'`)
  } catch (error) {
    console.warn(`Failed to cache route for '${hostname}${pathname}':`, error)
    // Don't throw - caching failure shouldn't break routing
  }
}
