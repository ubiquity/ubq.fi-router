/**
 * Main KV analytics engine
 */

import type { KVWriteMetrics, AnalyticsConfig } from './types'
import { DEFAULT_ANALYTICS_CONFIG } from './types'
import { calculateMetrics } from './projections'
import { getDailyCounter, getHourlyBucket, getCurrentSession } from './write-tracker'

/**
 * Get comprehensive KV analytics metrics
 */
export async function getKVAnalytics(
  kvNamespace: any,
  config: AnalyticsConfig = DEFAULT_ANALYTICS_CONFIG
): Promise<KVWriteMetrics> {
  try {
    // Get current analytics data
    const [dailyCounter, hourlyBucket, currentSession] = await Promise.all([
      getDailyCounter(kvNamespace),
      getHourlyBucket(kvNamespace),
      getCurrentSession(kvNamespace)
    ])

    // Extract values with defaults
    const dailyWrites = dailyCounter?.totalWrites || 0
    const currentHourWrites = hourlyBucket?.writes || 0
    const breakdown = dailyCounter?.breakdown || {}

    // Calculate comprehensive metrics
    const metrics = calculateMetrics(dailyWrites, currentHourWrites, breakdown, config)

    return metrics

  } catch (error) {
    console.error('Failed to get KV analytics:', error)

    // Return safe default metrics on error
    return {
      totalWrites: 0,
      dailyWrites: 0,
      hourlyRate: 0,
      projectedDailyTotal: 0,
      timeToNextReset: 0,
      alertLevel: 'safe',
      breakdown: {}
    }
  }
}

/**
 * Get analytics summary for monitoring dashboard
 */
export async function getAnalyticsSummary(
  kvNamespace: any,
  config: AnalyticsConfig = DEFAULT_ANALYTICS_CONFIG
): Promise<{
  current: KVWriteMetrics
  recommendations: string[]
  status: 'healthy' | 'warning' | 'critical' | 'exceeded'
}> {
  const metrics = await getKVAnalytics(kvNamespace, config)

  const recommendations: string[] = []
  let status: 'healthy' | 'warning' | 'critical' | 'exceeded' = 'healthy'

  switch (metrics.alertLevel) {
    case 'exceeded':
      status = 'exceeded'
      recommendations.push('⛔ Daily limit exceeded! KV writes are blocked.')
      recommendations.push('🕘 Wait until 0:00 UTC (9am KST) for limit reset.')
      break

    case 'critical':
      status = 'critical'
      recommendations.push('🔥 Critical: >90% of daily limit projected!')
      recommendations.push('⚡ Reduce non-essential KV operations immediately.')
      recommendations.push('📊 Monitor usage closely until reset.')
      break

    case 'warning':
      status = 'warning'
      recommendations.push('⚠️  Warning: >75% of daily limit projected.')
      recommendations.push('🎯 Consider optimizing high-frequency operations.')
      recommendations.push('📈 Monitor hourly usage trends.')
      break

    case 'safe':
      status = 'healthy'
      recommendations.push('✅ Usage is within safe limits.')
      recommendations.push('📊 Continue monitoring for trends.')
      break
  }

  // Add operation-specific recommendations
  const sortedOperations = Object.entries(metrics.breakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)

  if (sortedOperations.length > 0) {
    recommendations.push(`🔝 Top operations: ${sortedOperations.map(([op, count]) => `${op}(${count})`).join(', ')}`)
  }

  return {
    current: metrics,
    recommendations,
    status
  }
}

/**
 * Format time remaining until reset
 */
export function formatTimeToReset(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`
  } else if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  } else {
    return `${remainingSeconds}s`
  }
}

/**
 * Format usage percentage
 */
export function formatUsagePercentage(current: number, limit: number): string {
  const percentage = Math.round((current / limit) * 100)
  return `${percentage}%`
}