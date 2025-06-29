/**
 * RATE LIMITING DISABLED TO REDUCE KV WRITES
 * Direct KV writes without rate limiting to prevent extra writes
 */

import { kvPutWithFallback } from './kv-fallback-wrapper'

/**
 * Direct KV write without rate limiting
 */
export async function rateLimitedKVWrite(
  kvNamespace: any,
  key: string,
  value: any,
  operation: string,
  options?: { expirationTtl?: number }
): Promise<boolean> {
  try {
    // Direct write without rate limiting checks (which cause extra writes)
    const writeSuccess = await kvPutWithFallback(kvNamespace, key, value, options)
    console.log(`📝 KV write ${writeSuccess ? 'completed' : 'fell back (KV locked)'} for ${key} (${operation})`)
    return writeSuccess
  } catch (error) {
    console.error(`KV write failed for ${key} (${operation}):`, error)
    // Don't throw - return false to indicate write failed
    return false
  }
}

/**
 * Get rate limiting configuration for monitoring - DISABLED
 */
export function getRateLimitingConfig(): {
  patterns: Array<{
    pattern: string
    intervalSeconds: number
  }>
} {
  return { patterns: [] }
}
