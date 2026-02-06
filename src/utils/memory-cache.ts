/**
 * In-memory cache for Cloudflare Workers
 * Provides caching without requiring KV namespace
 * Uses module-level Map that persists across requests in the same isolate
 */

// Module-level cache - persists for lifetime of the Worker instance
const GLOBAL_CACHE = new Map<string, { value: string; expiresAt: number }>()

const DEFAULT_TTL = 24 * 60 * 60 // 24 hours in seconds

/**
 * Get a value from the in-memory cache
 */
export async function memoryGet(key: string): Promise<string | null> {
  const item = GLOBAL_CACHE.get(key)
  if (!item) {
    return null
  }
  
  // Check if expired
  if (Date.now() > item.expiresAt) {
    GLOBAL_CACHE.delete(key)
    return null
  }
  
  return item.value
}

/**
 * Get a JSON value from the in-memory cache
 */
export async function memoryGetJson<T>(key: string): Promise<T | null> {
  const value = await memoryGet(key)
  if (!value) return null
  
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/**
 * Put a value into the in-memory cache
 */
export async function memoryPut(
  key: string,
  value: string,
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  GLOBAL_CACHE.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  })
}

/**
 * Put a JSON value into the in-memory cache
 */
export async function memoryPutJson<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  await memoryPut(key, JSON.stringify(value), ttlSeconds)
}

/**
 * Delete a value from the in-memory cache
 */
export async function memoryDelete(key: string): Promise<void> {
  GLOBAL_CACHE.delete(key)
}

/**
 * Clear all entries from the in-memory cache
 */
export async function memoryClear(): Promise<void> {
  GLOBAL_CACHE.clear()
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats(): { size: number; keys: string[] } {
  const now = Date.now()
  const validKeys: string[] = []
  
  for (const [key, item] of GLOBAL_CACHE) {
    if (now < item.expiresAt) {
      validKeys.push(key)
    }
  }
  
  return {
    size: GLOBAL_CACHE.size,
    keys: validKeys
  }
}
