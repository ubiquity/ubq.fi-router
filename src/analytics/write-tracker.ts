/**
 * KV write interception and tracking
 */

import type { DailyCounter, HourlyBucket, CurrentSession } from './types'
import { getCurrentUtcDate, getCurrentUtcHour } from './projections'
import { kvGetWithFallback, kvPutWithFallback } from '../utils/kv-fallback-wrapper'

// In-memory cache for analytics to reduce KV reads
const analyticsCache = new Map<string, { value: any; expires: number }>()
const ANALYTICS_CACHE_TTL_MS = 2 * 60 * 1000 // 2 minutes

/**
 * Clean expired analytics cache entries
 */
function cleanAnalyticsCache(): void {
  const now = Date.now()
  Array.from(analyticsCache.entries()).forEach(([key, entry]) => {
    if (entry.expires < now) {
      analyticsCache.delete(key)
    }
  })
}

/**
 * Get from analytics cache or KV with fallback
 */
async function getAnalyticsData<T>(
  kvNamespace: any,
  key: string
): Promise<T | null> {
  // Check cache first
  const cached = analyticsCache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.value as T
  }

  try {
    const data = await kvGetWithFallback(kvNamespace, key, { type: 'json' })
    if (data !== null) {
      // Cache for faster access
      analyticsCache.set(key, {
        value: data,
        expires: Date.now() + ANALYTICS_CACHE_TTL_MS
      })
      return data as T
    }
    return null
  } catch (error) {
    console.warn(`Analytics read failed for key ${key}:`, error)
    return null
  }
}

/**
 * Put analytics data with fallback support
 */
async function putAnalyticsData(
  kvNamespace: any,
  key: string,
  value: any
): Promise<void> {
  try {
    await kvPutWithFallback(kvNamespace, key, JSON.stringify(value))

    // Update cache
    analyticsCache.set(key, {
      value,
      expires: Date.now() + ANALYTICS_CACHE_TTL_MS
    })
  } catch (error) {
    // Analytics writes are non-critical - log but don't throw
    console.warn(`Analytics write failed for key ${key}:`, error)
  }
}

/**
 * Track a KV write operation
 */
export async function trackKVWrite(
  kvNamespace: any,
  operationType: string
): Promise<void> {
  const currentDate = getCurrentUtcDate()
  const currentHour = getCurrentUtcHour()
  const timestamp = new Date().toISOString()

  // Clean cache periodically
  if (Math.random() < 0.1) {
    cleanAnalyticsCache()
  }

  try {
    // Update daily counter
    const dailyKey = `analytics:daily-counter:${currentDate}`
    const dailyCounter = await getAnalyticsData<DailyCounter>(kvNamespace, dailyKey) || {
      date: currentDate,
      totalWrites: 0,
      breakdown: {},
      lastUpdated: timestamp
    }

    dailyCounter.totalWrites += 1
    dailyCounter.breakdown[operationType] = (dailyCounter.breakdown[operationType] || 0) + 1
    dailyCounter.lastUpdated = timestamp

    await putAnalyticsData(kvNamespace, dailyKey, dailyCounter)

    // Update hourly bucket
    const hourlyKey = `analytics:hourly-bucket:${currentHour}`
    const hourlyBucket = await getAnalyticsData<HourlyBucket>(kvNamespace, hourlyKey) || {
      hour: currentHour,
      writes: 0,
      breakdown: {},
      timestamp
    }

    hourlyBucket.writes += 1
    hourlyBucket.breakdown[operationType] = (hourlyBucket.breakdown[operationType] || 0) + 1
    hourlyBucket.timestamp = timestamp

    await putAnalyticsData(kvNamespace, hourlyKey, hourlyBucket)

    // Update current session
    const sessionKey = 'analytics:current'
    const currentSession = await getAnalyticsData<CurrentSession>(kvNamespace, sessionKey) || {
      sessionWrites: 0,
      sessionBreakdown: {},
      lastWrite: timestamp,
      currentHour
    }

    // Reset session if hour changed
    if (currentSession.currentHour !== currentHour) {
      currentSession.sessionWrites = 0
      currentSession.sessionBreakdown = {}
      currentSession.currentHour = currentHour
    }

    currentSession.sessionWrites += 1
    currentSession.sessionBreakdown[operationType] = (currentSession.sessionBreakdown[operationType] || 0) + 1
    currentSession.lastWrite = timestamp

    await putAnalyticsData(kvNamespace, sessionKey, currentSession)

    console.log(`📊 KV write tracked: ${operationType} (daily: ${dailyCounter.totalWrites}, hourly: ${hourlyBucket.writes})`)

  } catch (error) {
    // Analytics tracking failure shouldn't break the main operation
    console.warn(`Analytics tracking failed for operation ${operationType}:`, error)
  }
}

/**
 * Get current daily counter
 */
export async function getDailyCounter(kvNamespace: any): Promise<DailyCounter | null> {
  const currentDate = getCurrentUtcDate()
  const dailyKey = `analytics:daily-counter:${currentDate}`
  return await getAnalyticsData<DailyCounter>(kvNamespace, dailyKey)
}

/**
 * Get current hourly bucket
 */
export async function getHourlyBucket(kvNamespace: any): Promise<HourlyBucket | null> {
  const currentHour = getCurrentUtcHour()
  const hourlyKey = `analytics:hourly-bucket:${currentHour}`
  return await getAnalyticsData<HourlyBucket>(kvNamespace, hourlyKey)
}

/**
 * Get current session data
 */
export async function getCurrentSession(kvNamespace: any): Promise<CurrentSession | null> {
  const sessionKey = 'analytics:current'
  return await getAnalyticsData<CurrentSession>(kvNamespace, sessionKey)
}