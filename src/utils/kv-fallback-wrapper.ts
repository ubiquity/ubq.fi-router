/**
 * KV fallback wrapper for Cloudflare Workers
 * Detects KV rate limiting and provides graceful degradation strategies
 */

/**
 * Check if error indicates KV rate limiting or lock
 */
function isKVRateLimited(error: any): boolean {
  const errorMessage = error?.message || String(error)
  const errorCode = error?.code

  // Cloudflare KV rate limit indicators
  return (
    errorCode === 10000 || // Official rate limit error code
    errorMessage.includes('Rate limited') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('Too Many Requests') ||
    errorMessage.includes('429')
  )
}

/**
 * Safe KV get operation with fallback to null when rate limited
 */
export async function kvGetWithFallback(
  kvNamespace: any,
  key: string,
  options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }
): Promise<any> {
  try {
    return await kvNamespace.get(key, options)
  } catch (error) {
    if (isKVRateLimited(error)) {
      console.warn(`⚠️ KV rate limited for GET ${key}, returning null`)
      return null
    }

    // Re-throw non-rate-limit errors
    throw error
  }
}

/**
 * Safe KV put operation that fails gracefully when rate limited
 */
export async function kvPutWithFallback(
  kvNamespace: any,
  key: string,
  value: any,
  options?: { expirationTtl?: number }
): Promise<boolean> {
  try {
    await kvNamespace.put(key, value, options)
    return true
  } catch (error) {
    if (isKVRateLimited(error)) {
      console.warn(`⚠️ KV rate limited for PUT ${key}, skipping cache write`)
      return false
    }

    // Re-throw non-rate-limit errors
    throw error
  }
}

/**
 * Safe KV delete operation that fails gracefully when rate limited
 */
export async function kvDeleteWithFallback(
  kvNamespace: any,
  key: string
): Promise<boolean> {
  try {
    await kvNamespace.delete(key)
    return true
  } catch (error) {
    if (isKVRateLimited(error)) {
      console.warn(`⚠️ KV rate limited for DELETE ${key}, skipping delete`)
      return false
    }

    // Re-throw non-rate-limit errors
    throw error
  }
}

/**
 * Safe KV list operation with fallback to empty list when rate limited
 */
export async function kvListWithFallback(
  kvNamespace: any,
  options?: { prefix?: string; limit?: number; cursor?: string }
): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: any }>; list_complete: boolean; cursor?: string }> {
  try {
    return await kvNamespace.list(options)
  } catch (error) {
    if (isKVRateLimited(error)) {
      console.warn(`⚠️ KV rate limited for LIST, returning empty result`)
      return {
        keys: [],
        list_complete: true
      }
    }

    // Re-throw non-rate-limit errors
    throw error
  }
}

/**
 * Export detection function for use in other modules
 */
export { isKVRateLimited }