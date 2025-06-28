#!/usr/bin/env bun

/**
 * Historical KV Log Analysis Tool
 * Analyzes Cloudflare Worker logs to estimate KV write usage from today
 * Helps determine actual usage when analytics tracking is not yet deployed
 */

import { execSync } from 'child_process'
import { DEFAULT_ANALYTICS_CONFIG } from '../src/analytics/types'

/**
 * Colors for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
}

/**
 * Log entry interface for parsed Cloudflare logs
 */
interface LogEntry {
  timestamp: string
  method: string
  url: string
  status: number
  userAgent?: string
  cfRay?: string
  duration?: number
  responseSize?: number
}

/**
 * KV write operation patterns to detect in logs
 */
interface KVWritePattern {
  name: string
  description: string
  pattern: RegExp
  estimatedWrites: number
}

/**
 * Patterns that indicate KV write operations
 */
const KV_WRITE_PATTERNS: KVWritePattern[] = [
  {
    name: 'sitemap_xml',
    description: 'Sitemap XML generation',
    pattern: /\/sitemap\.xml(\?|$)/i,
    estimatedWrites: 2 // Usually writes both cache and updated sitemap
  },
  {
    name: 'sitemap_json',
    description: 'Sitemap JSON generation',
    pattern: /\/sitemap\.json(\?|$)/i,
    estimatedWrites: 1
  },
  {
    name: 'plugin_map',
    description: 'Plugin map generation',
    pattern: /\/plugin-map\.json(\?|$)/i,
    estimatedWrites: 3 // Plugin discovery + map generation + cache update
  },
  {
    name: 'cache_refresh',
    description: 'Cache refresh requests',
    pattern: /.*[\?&]refresh=1|.*[\?&]force=1/i,
    estimatedWrites: 1
  },
  {
    name: 'cache_clear',
    description: 'Cache clear operations',
    pattern: /.*[\?&]clear=1|.*[\?&]flush=1/i,
    estimatedWrites: 0 // Clearing doesn't write, but indicates activity
  },
  {
    name: 'service_discovery',
    description: 'New service discovery',
    pattern: /^https?:\/\/[^\/]+\.ubq\.fi\/.*$/i,
    estimatedWrites: 1 // First-time service discovery writes to cache
  }
]

/**
 * Historical usage analysis result
 */
interface HistoricalUsage {
  totalEstimatedWrites: number
  operationBreakdown: Record<string, number>
  requestCount: number
  timeRange: {
    start: string
    end: string
  }
  confidence: 'high' | 'medium' | 'low'
  alerts: string[]
}

/**
 * Parse a single log line (JSON format from wrangler tail)
 */
function parseLogEntry(logLine: string): LogEntry | null {
  try {
    const parsed = JSON.parse(logLine)

    // Handle different log formats from wrangler
    if (parsed.event && parsed.event.request) {
      return {
        timestamp: parsed.timestamp || parsed.event.time || new Date().toISOString(),
        method: parsed.event.request.method || 'GET',
        url: parsed.event.request.url || '',
        status: parsed.event.response?.status || 200,
        userAgent: parsed.event.request.headers?.['User-Agent'],
        cfRay: parsed.event.request.headers?.['CF-Ray'],
        duration: parsed.event.response?.duration,
        responseSize: parsed.event.response?.size
      }
    }

    // Handle direct log format
    return {
      timestamp: parsed.timestamp || new Date().toISOString(),
      method: parsed.method || 'GET',
      url: parsed.url || '',
      status: parsed.status || 200,
      userAgent: parsed.userAgent,
      cfRay: parsed.cfRay,
      duration: parsed.duration,
      responseSize: parsed.responseSize
    }
  } catch (error) {
    // Skip unparseable lines
    return null
  }
}

/**
 * Analyze log entries for KV write patterns
 */
function analyzeLogsForKVWrites(logEntries: LogEntry[]): HistoricalUsage {
  const operationBreakdown: Record<string, number> = {}
  let totalEstimatedWrites = 0
  const alerts: string[] = []

  // Track unique services to avoid double-counting cache writes
  const discoveredServices = new Set<string>()

  for (const entry of logEntries) {
    // Skip non-successful requests for cache writes
    if (entry.status >= 400) {
      continue
    }

    for (const pattern of KV_WRITE_PATTERNS) {
      if (pattern.pattern.test(entry.url)) {
        // Special handling for service discovery to avoid double-counting
        if (pattern.name === 'service_discovery') {
          const hostname = new URL(entry.url).hostname
          if (!discoveredServices.has(hostname)) {
            discoveredServices.add(hostname)
            operationBreakdown[pattern.name] = (operationBreakdown[pattern.name] || 0) + pattern.estimatedWrites
            totalEstimatedWrites += pattern.estimatedWrites
          }
        } else {
          operationBreakdown[pattern.name] = (operationBreakdown[pattern.name] || 0) + pattern.estimatedWrites
          totalEstimatedWrites += pattern.estimatedWrites
        }
      }
    }
  }

  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low' = 'high'
  if (logEntries.length < 10) {
    confidence = 'low'
    alerts.push('⚠️  Low log volume - analysis may be incomplete')
  } else if (logEntries.length < 100) {
    confidence = 'medium'
    alerts.push('ℹ️  Medium log volume - estimates are approximate')
  }

  // Add alerts for high usage
  if (totalEstimatedWrites > DEFAULT_ANALYTICS_CONFIG.dailyLimit * 0.75) {
    alerts.push('🚨 Estimated usage >75% of daily limit')
  }

  if (totalEstimatedWrites > DEFAULT_ANALYTICS_CONFIG.dailyLimit) {
    alerts.push('⛔ Estimated usage exceeds daily limit!')
  }

  const timeRange = {
    start: logEntries.length > 0 ? logEntries[0].timestamp : new Date().toISOString(),
    end: logEntries.length > 0 ? logEntries[logEntries.length - 1].timestamp : new Date().toISOString()
  }

  return {
    totalEstimatedWrites,
    operationBreakdown,
    requestCount: logEntries.length,
    timeRange,
    confidence,
    alerts
  }
}

/**
 * Fetch logs from Cloudflare using wrangler tail
 */
async function fetchCloudflareLogsFromToday(): Promise<LogEntry[]> {
  try {
    console.log(`${colors.blue}📡 Fetching today's Cloudflare Worker logs...${colors.reset}`)

    // Calculate today's start time (0:00 UTC)
    const now = new Date()
    const todayStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const sinceTime = todayStart.toISOString()

    console.log(`${colors.blue}⏰ Fetching logs since: ${sinceTime} (0:00 UTC / 9am KST)${colors.reset}`)

    // Use wrangler tail to get recent logs
    // Note: wrangler tail doesn't support historical time ranges, so we'll get recent logs
    // and filter them by timestamp
    const command = `npx wrangler tail --format=json --compatibility-date=2023-05-18`

    console.log(`${colors.yellow}⚠️  Note: wrangler tail shows live logs. For historical analysis, we'll capture${colors.reset}`)
    console.log(`${colors.yellow}   recent traffic patterns and extrapolate from current usage.${colors.reset}`)
    console.log(`${colors.blue}🎯 Capturing 30 seconds of live traffic for analysis...${colors.reset}`)

    // Capture logs for 30 seconds to get a sample
    const output = execSync(`timeout 30 ${command} || true`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    })

    const lines = output.split('\n').filter(line => line.trim())
    const logEntries: LogEntry[] = []

    for (const line of lines) {
      const entry = parseLogEntry(line)
      if (entry) {
        // Filter for today's entries only
        const entryTime = new Date(entry.timestamp)
        if (entryTime >= todayStart) {
          logEntries.push(entry)
        }
      }
    }

    console.log(`${colors.green}✅ Captured ${logEntries.length} log entries from sample${colors.reset}`)
    return logEntries

  } catch (error) {
    console.warn(`${colors.yellow}⚠️  Could not fetch live logs (this is normal if no traffic):${colors.reset}`, error.message)

    // Fallback: Try to get some historical context from KV operations
    console.log(`${colors.blue}🔄 Attempting alternative log analysis...${colors.reset}`)

    // Return empty array for now - in a real implementation, we might
    // try other methods like Cloudflare Analytics API
    return []
  }
}

/**
 * Estimate daily usage based on current traffic patterns
 */
function extrapolateDailyUsage(analysis: HistoricalUsage): {
  estimatedDailyWrites: number
  hourlyRate: number
  projectedTotal: number
} {
  const now = new Date()
  const todayStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const hoursElapsed = (now.getTime() - todayStart.getTime()) / (1000 * 60 * 60)

  // Calculate hourly rate from current data
  const hourlyRate = hoursElapsed > 0 ? analysis.totalEstimatedWrites / hoursElapsed : 0

  // Project full day based on current rate
  const projectedTotal = Math.ceil(hourlyRate * 24)

  return {
    estimatedDailyWrites: analysis.totalEstimatedWrites,
    hourlyRate: Math.ceil(hourlyRate),
    projectedTotal
  }
}

/**
 * Format percentage with color
 */
function formatColoredPercentage(current: number, limit: number): string {
  const percentage = (current / limit) * 100
  let color = colors.green

  if (percentage >= 100) {
    color = colors.red
  } else if (percentage >= 90) {
    color = colors.red
  } else if (percentage >= 75) {
    color = colors.yellow
  }

  return `${color}${percentage.toFixed(1)}%${colors.reset}`
}

/**
 * Main analysis function
 */
async function runHistoricalKVAnalysis() {
  try {
    console.log(`${colors.cyan}${colors.bright}📊 Historical KV Usage Analysis${colors.reset}`)
    console.log(`${colors.cyan}===============================${colors.reset}\n`)

    // Check wrangler authentication
    try {
      execSync('npx wrangler whoami', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      console.log(`${colors.green}✅ Wrangler authenticated${colors.reset}`)
    } catch {
      console.error(`${colors.red}❌ Wrangler authentication required${colors.reset}`)
      console.error(`${colors.yellow}Please run: npx wrangler login${colors.reset}`)
      process.exit(1)
    }

    // Fetch and analyze logs
    const logEntries = await fetchCloudflareLogsFromToday()
    const analysis = analyzeLogsForKVWrites(logEntries)
    const dailyProjection = extrapolateDailyUsage(analysis)

    // Display results
    console.log(`\n${colors.bright}📊 Historical KV Usage Analysis${colors.reset}`)
    console.log(`${colors.cyan}===============================${colors.reset}\n`)

    const usagePercentage = formatColoredPercentage(dailyProjection.estimatedDailyWrites, DEFAULT_ANALYTICS_CONFIG.dailyLimit)
    const projectedPercentage = formatColoredPercentage(dailyProjection.projectedTotal, DEFAULT_ANALYTICS_CONFIG.dailyLimit)

    console.log(`${colors.bright}Today's Estimated Usage (from logs):${colors.reset}`)
    console.log(`- Current writes: ${dailyProjection.estimatedDailyWrites}/${DEFAULT_ANALYTICS_CONFIG.dailyLimit} (${usagePercentage})`)
    console.log(`- Hourly rate: ${dailyProjection.hourlyRate} writes/hour`)
    console.log(`- Projected total: ${dailyProjection.projectedTotal}/1000 writes (${projectedPercentage})`)

    console.log(`\n${colors.bright}Log Analysis Period:${colors.reset}`)
    const startTime = new Date(analysis.timeRange.start)
    const endTime = new Date(analysis.timeRange.end)
    console.log(`- Start: ${startTime.toLocaleString()} UTC`)
    console.log(`- End: ${endTime.toLocaleString()} UTC`)
    console.log(`- Requests analyzed: ${analysis.requestCount}`)
    console.log(`- Confidence: ${analysis.confidence}`)

    // Operation breakdown
    if (Object.keys(analysis.operationBreakdown).length > 0) {
      console.log(`\n${colors.bright}Estimated Operation Breakdown:${colors.reset}`)
      const sortedOps = Object.entries(analysis.operationBreakdown)
        .sort(([,a], [,b]) => b - a)

      for (const [operation, writes] of sortedOps) {
        const pattern = KV_WRITE_PATTERNS.find(p => p.name === operation)
        const description = pattern?.description || operation
        const percentage = ((writes / dailyProjection.estimatedDailyWrites) * 100).toFixed(1)
        console.log(`- ${description}: ${writes} writes (${percentage}%)`)
      }
    }

    // Alerts and recommendations
    if (analysis.alerts.length > 0) {
      console.log(`\n${colors.bright}Alerts:${colors.reset}`)
      analysis.alerts.forEach(alert => console.log(alert))
    }

    // Alert level based on projection
    let alertLevel = 'safe'
    let alertEmoji = '✅'
    let alertColor = colors.green

    const projectedPercentageNum = (dailyProjection.projectedTotal / DEFAULT_ANALYTICS_CONFIG.dailyLimit) * 100

    if (projectedPercentageNum >= 100) {
      alertLevel = 'exceeded'
      alertEmoji = '⛔'
      alertColor = colors.red
    } else if (projectedPercentageNum >= 90) {
      alertLevel = 'critical'
      alertEmoji = '🔥'
      alertColor = colors.red
    } else if (projectedPercentageNum >= 75) {
      alertLevel = 'warning'
      alertEmoji = '⚠️'
      alertColor = colors.yellow
    }

    console.log(`\n${colors.bright}Alert Level:${colors.reset} ${alertEmoji} ${alertColor}${alertLevel.charAt(0).toUpperCase() + alertLevel.slice(1)}${colors.reset}`)

    // Time to reset
    const now = new Date()
    const nextReset = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    const timeToReset = Math.floor((nextReset.getTime() - now.getTime()) / 1000)
    const hours = Math.floor(timeToReset / 3600)
    const minutes = Math.floor((timeToReset % 3600) / 60)

    console.log(`${colors.bright}Time to Reset:${colors.reset} ${hours}h ${minutes}m (0:00 UTC / 9am KST tomorrow)`)

    console.log(`\n${colors.bright}Note:${colors.reset} This analysis is based on log patterns and traffic sampling.`)
    console.log(`For precise tracking, deploy the analytics system to get real-time KV write counts.`)

  } catch (error) {
    console.error(`${colors.red}❌ Error analyzing historical KV usage:${colors.reset}`)
    console.error(error)
    process.exit(1)
  }
}

// Run if this is the main script
if (import.meta.url === `file://${process.argv[1]}`) {
  await runHistoricalKVAnalysis()
}

export { runHistoricalKVAnalysis, analyzeLogsForKVWrites, fetchCloudflareLogsFromToday, type HistoricalUsage }