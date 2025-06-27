/**
 * Usage projection calculations for KV analytics
 */

import type { AnalyticsConfig, KVWriteMetrics } from './types'

/**
 * Get current UTC date in YYYY-MM-DD format
 */
export function getCurrentUtcDate(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Get current UTC hour in YYYY-MM-DD-HH format
 */
export function getCurrentUtcHour(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hour = String(now.getUTCHours()).padStart(2, '0')
  return `${year}-${month}-${day}-${hour}`
}

/**
 * Calculate time until next UTC reset (0:00 UTC / 9am KST)
 */
export function getTimeToNextReset(): number {
  const now = new Date()
  const nextReset = new Date(now)
  nextReset.setUTCHours(0, 0, 0, 0)
  nextReset.setUTCDate(nextReset.getUTCDate() + 1)

  return Math.floor((nextReset.getTime() - now.getTime()) / 1000)
}

/**
 * Calculate hourly write rate based on current hour
 */
export function calculateHourlyRate(currentHourWrites: number): number {
  const now = new Date()
  const currentMinute = now.getUTCMinutes()
  const currentSecond = now.getUTCSeconds()

  // Calculate minutes elapsed in current hour
  const minutesElapsed = currentMinute + (currentSecond / 60)

  if (minutesElapsed < 1) {
    // Too early in the hour to calculate meaningful rate
    return currentHourWrites * 60 // Assume current rate continues
  }

  // Extrapolate to full hour
  const writesPerMinute = currentHourWrites / minutesElapsed
  return Math.round(writesPerMinute * 60)
}

/**
 * Project daily total based on current writes and hourly rate
 */
export function projectDailyTotal(
  dailyWrites: number,
  hourlyRate: number,
  timeToReset: number
): number {
  const hoursUntilReset = timeToReset / 3600
  const projectedAdditionalWrites = hourlyRate * hoursUntilReset
  return Math.round(dailyWrites + projectedAdditionalWrites)
}

/**
 * Determine alert level based on projected usage
 */
export function getAlertLevel(
  projectedTotal: number,
  config: AnalyticsConfig
): 'safe' | 'warning' | 'critical' | 'exceeded' {
  const percentage = projectedTotal / config.dailyLimit

  if (percentage >= 1.0) {
    return 'exceeded'
  } else if (percentage >= config.criticalThreshold) {
    return 'critical'
  } else if (percentage >= config.warningThreshold) {
    return 'warning'
  } else {
    return 'safe'
  }
}

/**
 * Calculate comprehensive KV write metrics
 */
export function calculateMetrics(
  dailyWrites: number,
  currentHourWrites: number,
  breakdown: Record<string, number>,
  config: AnalyticsConfig
): KVWriteMetrics {
  const hourlyRate = calculateHourlyRate(currentHourWrites)
  const timeToNextReset = getTimeToNextReset()
  const projectedDailyTotal = projectDailyTotal(dailyWrites, hourlyRate, timeToNextReset)
  const alertLevel = getAlertLevel(projectedDailyTotal, config)

  return {
    totalWrites: dailyWrites,
    dailyWrites,
    hourlyRate,
    projectedDailyTotal,
    timeToNextReset,
    alertLevel,
    breakdown
  }
}