import { trackKVWrite, getDailyCounter } from '../analytics/write-tracker'

interface WriteTimestamp {
  lastWrite: number
  operationType: string
}

// Cache for tracking last write times in memory (per worker instance)
const writeTimestamps = new Map<string, WriteTimestamp>()

const BASE_RATE_LIMIT_MS = 3 * 60 * 1000 // 3 minutes base interval
const TARGET_DAILY_WRITES = 400 // Target max 400 writes/day (80% of 500 limit)
const MIN_RATE_LIMIT_MS = 2 * 60 * 1000 // Minimum 2 minutes
const MAX_RATE_LIMIT_MS = 15 * 60 * 1000 // Maximum 15 minutes

/**
 * Calculate adaptive rate limit based on daily usage vs time progression
 * Uses smart algorithm to naturally stay under daily limits without blocking
 */
function calculateAdaptiveRateLimit(currentDailyWrites: number): number {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msElapsedToday = now.getTime() - startOfDay.getTime()
  const msInDay = 24 * 60 * 60 * 1000
  const dayProgress = msElapsedToday / msInDay // 0.0 to 1.0

  // Calculate expected writes by this time of day (linear distribution)
  const expectedWritesByNow = TARGET_DAILY_WRITES * dayProgress

  // Calculate usage ratio: actual vs expected
  const usageRatio = currentDailyWrites / Math.max(expectedWritesByNow, 1)

  // Adaptive multiplier: slow down if ahead of schedule, speed up if behind
  let multiplier = 1.0

  if (usageRatio > 1.5) {
    // Way ahead of schedule - slow down significantly
    multiplier = 4.0
  } else if (usageRatio > 1.2) {
    // Ahead of schedule - slow down moderately
    multiplier = 2.5
  } else if (usageRatio > 1.0) {
    // Slightly ahead - slow down a bit
    multiplier = 1.5
  } else if (usageRatio < 0.5) {
    // Well behind schedule - can speed up
    multiplier = 0.7
  } else if (usageRatio < 0.8) {
    // Slightly behind - speed up a bit
    multiplier = 0.9
  }

  const adaptiveLimit = BASE_RATE_LIMIT_MS * multiplier
  return Math.max(MIN_RATE_LIMIT_MS, Math.min(MAX_RATE_LIMIT_MS, adaptiveLimit))
}

/**
 * Smart rate-limited KV write function that adaptively adjusts intervals
 * to naturally stay under daily limits without blocking or warnings
 */
export async function rateLimitedKVWrite(
  kvNamespace: any,
  key: string,
  value: any,
  operationType: string,
  options?: { expirationTtl?: number }
): Promise<boolean> {
  const now = Date.now()
  const cacheKey = `${operationType}:${key}`
  const lastWrite = writeTimestamps.get(cacheKey)

  try {
    // Get current daily usage for adaptive calculation
    const dailyCounter = await getDailyCounter(kvNamespace)
    const currentDailyWrites = dailyCounter?.totalWrites || 0

    // Calculate adaptive rate limit based on current usage
    const adaptiveRateLimit = calculateAdaptiveRateLimit(currentDailyWrites)

    // Check adaptive time-based rate limit
    if (lastWrite && (now - lastWrite.lastWrite) < adaptiveRateLimit) {
      const timeRemaining = Math.ceil((adaptiveRateLimit - (now - lastWrite.lastWrite)) / 1000)
      console.log(`⏰ Adaptive rate limit: Skipping ${operationType} write for ${key} (${timeRemaining}s remaining)`)
      return false
    }

    // Perform the KV write
    await kvNamespace.put(key, value, options)

    // Update timestamp cache
    writeTimestamps.set(cacheKey, {
      lastWrite: now,
      operationType
    })

    // Track analytics
    await trackKVWrite(kvNamespace, operationType).catch(error => {
      console.warn(`Analytics tracking failed for ${operationType}:`, error)
    })

    const intervalMinutes = Math.round(adaptiveRateLimit / 60000)
    console.log(`✅ Smart KV write: ${operationType} - ${key} (${currentDailyWrites + 1}/${TARGET_DAILY_WRITES}, next: ${intervalMinutes}min)`)
    return true

  } catch (error) {
    console.error(`❌ Rate-limited KV write failed for ${operationType}:`, error)
    throw error
  }
}

/**
 * Smart rate-limited bulk KV write with adaptive intervals
 */
export async function rateLimitedBulkKVWrite(
  kvNamespace: any,
  writes: Array<{ key: string; value: any; options?: { expirationTtl?: number } }>,
  operationType: string
): Promise<boolean> {
  const now = Date.now()
  const cacheKey = `${operationType}:bulk`
  const lastWrite = writeTimestamps.get(cacheKey)

  try {
    // Get current daily usage for adaptive calculation
    const dailyCounter = await getDailyCounter(kvNamespace)
    const currentDailyWrites = dailyCounter?.totalWrites || 0

    // Calculate adaptive rate limit based on current usage
    const adaptiveRateLimit = calculateAdaptiveRateLimit(currentDailyWrites)

    // Check adaptive time-based rate limit
    if (lastWrite && (now - lastWrite.lastWrite) < adaptiveRateLimit) {
      const timeRemaining = Math.ceil((adaptiveRateLimit - (now - lastWrite.lastWrite)) / 1000)
      console.log(`⏰ Adaptive rate limit: Skipping ${operationType} bulk write (${writes.length} keys, ${timeRemaining}s remaining)`)
      return false
    }

    // Perform all KV writes
    for (const write of writes) {
      await kvNamespace.put(write.key, write.value, write.options)
    }

    // Update timestamp cache
    writeTimestamps.set(cacheKey, {
      lastWrite: now,
      operationType
    })

    // Track analytics for bulk operation (count as single operation)
    await trackKVWrite(kvNamespace, operationType).catch(error => {
      console.warn(`Analytics tracking failed for ${operationType}:`, error)
    })

    const intervalMinutes = Math.round(adaptiveRateLimit / 60000)
    console.log(`✅ Smart bulk KV write: ${operationType} - ${writes.length} keys (${currentDailyWrites + 1}/${TARGET_DAILY_WRITES}, next: ${intervalMinutes}min)`)
    return true

  } catch (error) {
    console.error(`❌ Rate-limited bulk KV write failed for ${operationType}:`, error)
    throw error
  }
}