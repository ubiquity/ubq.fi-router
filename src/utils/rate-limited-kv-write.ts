/**
 * Simple KV write rate limiting with emergency fallback protection
 * Uses time-based intervals without persistent memory tracking (serverless-friendly)
 */

import { kvPutWithFallback, kvGetWithFallback } from './kv-fallback-wrapper'

/**
 * Calculate write interval based on key pattern
 */
function getWriteInterval(keyPattern: string): number {
  // Base intervals (in seconds) for different key patterns
  const baseIntervals: Record<string, number> = {
    'route': 30,
    'sitemap': 300,
    'plugin-map': 180,
    'analytics': 60,
    'kv-writes': 120
  }

  return baseIntervals[keyPattern] || 60 // Default 60 seconds
}

/**
 * Check if enough time has passed since last write for this key pattern
 */
async function shouldAllowWrite(
  kvNamespace: any,
  keyPattern: string
): Promise<boolean> {
  const cacheKey = `last-write:${keyPattern}`
  const interval = getWriteInterval(keyPattern)

  try {
    const lastWriteTimeStr = await kvGetWithFallback(kvNamespace, cacheKey)
    if (!lastWriteTimeStr) {
      return true // No previous write recorded
    }

    const lastWriteTime = parseInt(lastWriteTimeStr)
    const timeSinceLastWrite = (Date.now() - lastWriteTime) / 1000

    return timeSinceLastWrite >= interval
  } catch (error) {
    // If we can't check last write time, allow the write
    console.warn(`Could not check last write time for ${keyPattern}:`, error)
    return true
  }
}

/**
 * Rate-limited KV write with emergency fallback protection
 */
export async function rateLimitedKVWrite(
  kvNamespace: any,
  key: string,
  value: any,
  operation: string,
  options?: { expirationTtl?: number }
): Promise<boolean> {
  // Extract key pattern for rate limiting (e.g., 'route:' -> 'route')
  const keyPattern = key.split(':')[0] || 'default'

  // Check rate limiting
  const allowWrite = await shouldAllowWrite(kvNamespace, keyPattern)

  if (!allowWrite) {
    const interval = getWriteInterval(keyPattern)
    console.log(`⏰ KV write rate limited for ${key} (${operation}). Min interval: ${interval}s`)
    return false
  }

  try {
    // Attempt KV write with fallback protection
    const writeSuccess = await kvPutWithFallback(kvNamespace, key, value, options)

    // Update last write time if KV write succeeded
    if (writeSuccess) {
      const cacheKey = `last-write:${keyPattern}`
      try {
        await kvPutWithFallback(kvNamespace, cacheKey, Date.now().toString(), { expirationTtl: 86400 })
      } catch (error) {
        // Failing to update last write time is not critical
        console.warn(`Failed to update last write time for ${keyPattern}:`, error)
      }
    }

    const statusMsg = writeSuccess ? 'completed' : 'fell back (KV rate limited)'
    console.log(`📝 Rate-limited KV write ${statusMsg} for ${key} (${operation})`)

    return writeSuccess

  } catch (error) {
    console.error(`Rate-limited KV write failed for ${key} (${operation}):`, error)
    throw error
  }
}

/**
 * Get rate limiting configuration for monitoring
 */
export function getRateLimitingConfig(): {
  patterns: Array<{
    pattern: string
    intervalSeconds: number
  }>
} {
  const patterns = ['route', 'sitemap', 'plugin-map', 'analytics', 'kv-writes']

  return {
    patterns: patterns.map(pattern => ({
      pattern,
      intervalSeconds: getWriteInterval(pattern)
    }))
  }
}