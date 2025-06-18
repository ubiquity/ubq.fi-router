/**
 * Simple cache management - CRASH on corruption
 * No defensive coding, explicit failures only
 */

export interface CacheConfig {
  ttlHours: number
  prefix: string
}

/**
 * Get from cache - CRASH if corrupt
 */
export async function getFromCache<T>(
  kvNamespace: any,
  key: string,
  config: CacheConfig
): Promise<T | null> {
  const fullKey = `${config.prefix}:${key}`
  
  try {
    const cached = await kvNamespace.get(fullKey, { type: 'json' })
    if (cached === null) {
      return null
    }
    
    // CRASH if cache is corrupt/unexpected type
    if (typeof cached !== 'object') {
      throw new Error(`Cache corruption: expected object but got ${typeof cached} for key ${fullKey}`)
    }
    
    return cached as T
  } catch (error) {
    // Re-throw to crash - no recovery
    throw new Error(`Cache read failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Put to cache - CRASH if write fails
 */
export async function putToCache<T>(
  kvNamespace: any,
  key: string,
  value: T,
  config: CacheConfig
): Promise<void> {
  const fullKey = `${config.prefix}:${key}`
  const ttlSeconds = config.ttlHours * 60 * 60
  
  try {
    await kvNamespace.put(fullKey, JSON.stringify(value), { 
      expirationTtl: ttlSeconds 
    })
  } catch (error) {
    // CRASH if cache write fails
    throw new Error(`Cache write failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Clear cache entry - CRASH if delete fails
 */
export async function clearFromCache(
  kvNamespace: any,
  key: string,
  config: CacheConfig
): Promise<void> {
  const fullKey = `${config.prefix}:${key}`
  
  try {
    await kvNamespace.delete(fullKey)
  } catch (error) {
    throw new Error(`Cache delete failed for key ${fullKey}: ${(error as Error).message}`)
  }
}

/**
 * Clear all cache entries with prefix - CRASH if any delete fails
 */
export async function clearAllCache(
  kvNamespace: any,
  config: CacheConfig
): Promise<number> {
  try {
    const list = await kvNamespace.list({ prefix: `${config.prefix}:` })
    const deletePromises = list.keys.map((item: any) => 
      kvNamespace.delete(item.name)
    )
    
    await Promise.all(deletePromises)
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
