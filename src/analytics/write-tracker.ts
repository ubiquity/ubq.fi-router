/**
 * ANALYTICS DISABLED TO REDUCE KV WRITES
 * This module now does nothing to prevent KV write amplification
 */

import type { DailyCounter, HourlyBucket, CurrentSession } from './types'

/**
 * Track a KV write operation - DISABLED
 */
export async function trackKVWrite(
  kvNamespace: any,
  operationType: string
): Promise<void> {
  // DISABLED - Was causing 3x write amplification
  return Promise.resolve()
}

/**
 * Get current daily counter - DISABLED
 */
export async function getDailyCounter(kvNamespace: any): Promise<DailyCounter | null> {
  return null
}

/**
 * Get current hourly bucket - DISABLED
 */
export async function getHourlyBucket(kvNamespace: any): Promise<HourlyBucket | null> {
  return null
}

/**
 * Get current session data - DISABLED
 */
export async function getCurrentSession(kvNamespace: any): Promise<CurrentSession | null> {
  return null
}
