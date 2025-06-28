#!/usr/bin/env bun

/**
 * Enhanced KV Analytics CLI Tool
 * Displays comprehensive KV usage analytics from production KV + historical log analysis
 * Uses wrangler KV CLI commands to access real production data
 * Includes historical log analysis to estimate actual usage when analytics data is missing
 */

import { execSync } from 'child_process'
import { getAnalyticsSummary, formatTimeToReset } from '../src/analytics/kv-analytics'
import { DEFAULT_ANALYTICS_CONFIG } from '../src/analytics/types'
import { runHistoricalKVAnalysis, analyzeLogsForKVWrites, type HistoricalUsage } from './analyze-kv-logs'

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
 * KV Namespace configuration from wrangler.toml
 */
const KV_CONFIG = {
  namespaceId: '01f073a865f742088b1d8c7dd348442b',
  binding: 'ROUTER_CACHE'
}

/**
 * Production KV namespace implementation using wrangler CLI
 */
class WranglerKVNamespace {
  private namespaceId: string

  constructor(namespaceId: string) {
    this.namespaceId = namespaceId
  }

  async get(key: string, options?: { type?: 'json' }): Promise<any> {
    try {
      const command = `npx wrangler kv key get "${key}" --namespace-id ${this.namespaceId}`
      const output = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      const trimmed = output.trim()

      if (!trimmed) {
        return null
      }

      if (options?.type === 'json') {
        try {
          // Handle wrangler CLI specific outputs
          if (trimmed === 'Value not found') {
            return null
          }

          // Handle wrangler CLI output format: "Value: {json}" or just "{json}"
          const valueMatch = trimmed.match(/^Value:\s*(.+)$/)
          const jsonString = valueMatch ? valueMatch[1] : trimmed
          return JSON.parse(jsonString)
        } catch (error) {
          console.warn(`Failed to parse JSON for key ${key}:`, error)
          console.warn(`Raw output: "${trimmed}"`)
          return null
        }
      }

      // For non-JSON requests, handle "Value not found" and strip "Value: " prefix if present
      if (trimmed === 'Value not found') {
        return null
      }

      const valueMatch = trimmed.match(/^Value:\s*(.+)$/)
      return valueMatch ? valueMatch[1] : trimmed
    } catch (error) {
      // Key doesn't exist or other error
      return null
    }
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    // This CLI tool is read-only, so we don't implement put
    console.warn('KV put operations not supported in CLI analytics tool')
  }

  async delete(key: string): Promise<void> {
    // This CLI tool is read-only, so we don't implement delete
    console.warn('KV delete operations not supported in CLI analytics tool')
  }

  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    try {
      let command = `npx wrangler kv key list --namespace-id ${this.namespaceId}`
      if (options?.prefix) {
        command += ` --prefix "${options.prefix}"`
      }

      const output = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      const keys = JSON.parse(output.trim() || '[]')

      return { keys: keys.map((k: any) => ({ name: k.name })) }
    } catch (error) {
      console.warn('Failed to list KV keys:', error)
      return { keys: [] }
    }
  }
}

/**
 * Format percentage with color based on level
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
 * Get alert level emoji and color
 */
function getAlertDisplay(alertLevel: string): { emoji: string; color: string } {
  switch (alertLevel) {
    case 'exceeded':
      return { emoji: '⛔', color: colors.red }
    case 'critical':
      return { emoji: '🔥', color: colors.red }
    case 'warning':
      return { emoji: '⚠️', color: colors.yellow }
    case 'safe':
    default:
      return { emoji: '✅', color: colors.green }
  }
}

/**
 * Format time remaining with colors
 */
function formatColoredTimeToReset(seconds: number): string {
  const formatted = formatTimeToReset(seconds)
  const hours = Math.floor(seconds / 3600)

  let color = colors.green
  if (hours < 2) {
    color = colors.red
  } else if (hours < 6) {
    color = colors.yellow
  }

  return `${color}${formatted}${colors.reset}`
}

/**
 * Check if wrangler is available and authenticated
 */
async function checkWranglerAuth(): Promise<boolean> {
  try {
    execSync('npx wrangler whoami', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

/**
 * Combine KV analytics with historical log analysis
 */
async function getCombinedAnalytics(kvNamespace: any): Promise<{
  kvAnalytics: any
  historicalAnalysis?: HistoricalUsage
  combinedEstimate: {
    estimatedDailyWrites: number
    dataSource: 'kv' | 'logs' | 'combined'
    confidence: 'high' | 'medium' | 'low'
  }
}> {
  const kvAnalytics = await getAnalyticsSummary(kvNamespace, DEFAULT_ANALYTICS_CONFIG)

  // If KV analytics has data, use it as primary source
  if (kvAnalytics.current.dailyWrites > 0) {
    return {
      kvAnalytics,
      combinedEstimate: {
        estimatedDailyWrites: kvAnalytics.current.dailyWrites,
        dataSource: 'kv',
        confidence: 'high'
      }
    }
  }

  // If no KV data, fall back to historical log analysis
  console.log(`${colors.yellow}📊 No KV analytics data found. Attempting historical log analysis...${colors.reset}`)

  // For now, just return the KV analytics with a note about missing data
  console.log(`${colors.yellow}💡 Historical log analysis available via: bun scripts/analyze-kv-logs.ts${colors.reset}`)
  return {
    kvAnalytics,
    combinedEstimate: {
      estimatedDailyWrites: 0,
      dataSource: 'kv',
      confidence: 'low'
    }
  }
}

/**
 * Display usage information
 */
function showUsage() {
  console.log(`${colors.cyan}${colors.bright}📊 KV Analytics CLI Tool${colors.reset}`)
  console.log(`${colors.cyan}=======================${colors.reset}\n`)
  console.log(`${colors.bright}Usage:${colors.reset}`)
  console.log(`  ${colors.green}bun scripts/kv-analytics.ts${colors.reset}         - Current KV analytics from production data`)
  console.log(`  ${colors.green}bun scripts/kv-analytics.ts --logs${colors.reset}  - Include historical log analysis`)
  console.log(`  ${colors.green}bun scripts/analyze-kv-logs.ts${colors.reset}      - Standalone historical log analysis\n`)
  console.log(`${colors.bright}Options:${colors.reset}`)
  console.log(`  ${colors.yellow}--logs${colors.reset}     Include historical log analysis for complete picture`)
  console.log(`  ${colors.yellow}--help${colors.reset}     Show this help message\n`)
  console.log(`${colors.bright}Examples:${colors.reset}`)
  console.log(`  # Quick KV analytics check`)
  console.log(`  ${colors.blue}bun scripts/kv-analytics.ts${colors.reset}`)
  console.log(`  # Historical usage analysis (for when analytics data is missing)`)
  console.log(`  ${colors.blue}bun scripts/analyze-kv-logs.ts${colors.reset}`)
}

/**
 * Main CLI function with enhanced analytics
 */
async function runKVAnalytics() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2)
    const includeLogAnalysis = args.includes('--logs')
    const showHelp = args.includes('--help') || args.includes('-h')

    if (showHelp) {
      showUsage()
      process.exit(0)
    }

    console.log(`${colors.cyan}${colors.bright}📊 Enhanced KV Analytics Report${colors.reset}`)
    console.log(`${colors.cyan}================================${colors.reset}\n`)

    // Check wrangler authentication
    console.log(`${colors.blue}🔐 Checking wrangler authentication...${colors.reset}`)
    const isAuthenticated = await checkWranglerAuth()

    if (!isAuthenticated) {
      console.error(`${colors.red}❌ Wrangler authentication required${colors.reset}`)
      console.error(`${colors.yellow}Please run: npx wrangler login${colors.reset}`)
      process.exit(1)
    }

    console.log(`${colors.green}✅ Wrangler authenticated${colors.reset}`)

    // Create KV namespace instance
    const kvNamespace = new WranglerKVNamespace(KV_CONFIG.namespaceId)
    console.log(`${colors.green}✅ Connected to production KV namespace (${KV_CONFIG.binding})${colors.reset}`)
    console.log(`${colors.blue}📋 Namespace ID: ${KV_CONFIG.namespaceId}${colors.reset}\n`)

    // Get analytics data
    console.log(`${colors.blue}📊 Fetching analytics data from production KV...${colors.reset}`)
    const summary = await getAnalyticsSummary(kvNamespace, DEFAULT_ANALYTICS_CONFIG)
    const { current, recommendations, status } = summary

    const alertDisplay = getAlertDisplay(current.alertLevel)
    const usageColor = formatColoredPercentage(current.dailyWrites, DEFAULT_ANALYTICS_CONFIG.dailyLimit)
    const projectedColor = formatColoredPercentage(current.projectedDailyTotal, DEFAULT_ANALYTICS_CONFIG.dailyLimit)

    console.log(`${colors.green}✅ Analytics data retrieved${colors.reset}\n`)

    // Main metrics display
    console.log(`${colors.bright}Daily Usage:${colors.reset} ${current.dailyWrites}/${DEFAULT_ANALYTICS_CONFIG.dailyLimit} writes (${usageColor})`)
    console.log(`${colors.bright}Projected Total:${colors.reset} ${current.projectedDailyTotal} writes (${projectedColor})`)
    console.log(`${colors.bright}Time to Reset:${colors.reset} ${formatColoredTimeToReset(current.timeToNextReset)} (0:00 UTC / 9am KST)`)
    console.log(`${colors.bright}Alert Level:${colors.reset} ${alertDisplay.emoji} ${alertDisplay.color}${current.alertLevel.charAt(0).toUpperCase() + current.alertLevel.slice(1)}${colors.reset}`)

    // Show data source status
    if (current.dailyWrites === 0 && Object.keys(current.breakdown).length === 0) {
      console.log(`\n${colors.yellow}ℹ️  No analytics data found in production KV. This could mean:${colors.reset}`)
      console.log(`${colors.yellow}- Analytics tracking was recently implemented and needs time to accumulate data${colors.reset}`)
      console.log(`${colors.yellow}- The router hasn't processed any requests since the last daily reset (0:00 UTC)${colors.reset}`)
      console.log(`${colors.yellow}- Analytics keys may be using a different prefix pattern${colors.reset}`)

      console.log(`\n${colors.cyan}${colors.bright}📊 To analyze actual historical usage from today:${colors.reset}`)
      console.log(`${colors.green}  bun scripts/analyze-kv-logs.ts${colors.reset}`)
      console.log(`${colors.blue}  This will analyze Cloudflare logs to estimate KV writes from request patterns${colors.reset}`)

      // Check if there are any analytics-related keys at all
      try {
        const analyticsList = await kvNamespace.list({ prefix: 'analytics:' })
        if (analyticsList.keys.length === 0) {
          console.log(`${colors.yellow}- No 'analytics:*' keys found in KV namespace${colors.reset}`)

          // Check for any keys at all to verify KV access
          const allKeys = await kvNamespace.list()
          if (allKeys.keys.length === 0) {
            console.log(`${colors.yellow}- KV namespace is completely empty${colors.reset}`)
          } else {
            console.log(`${colors.blue}- Found ${allKeys.keys.length} total keys in KV namespace${colors.reset}`)
            console.log(`${colors.blue}- Sample keys:${colors.reset}`)
            allKeys.keys.slice(0, 5).forEach(key => {
              console.log(`${colors.blue}  • ${key.name}${colors.reset}`)
            })
            if (allKeys.keys.length > 5) {
              console.log(`${colors.blue}  ... and ${allKeys.keys.length - 5} more${colors.reset}`)
            }
          }
        } else {
          console.log(`${colors.blue}- Found ${analyticsList.keys.length} analytics keys in KV:${colors.reset}`)
          analyticsList.keys.slice(0, 5).forEach(key => {
            console.log(`${colors.blue}  • ${key.name}${colors.reset}`)
          })
          if (analyticsList.keys.length > 5) {
            console.log(`${colors.blue}  ... and ${analyticsList.keys.length - 5} more${colors.reset}`)
          }
        }
      } catch (error) {
        console.log(`${colors.yellow}- Could not list KV keys: ${error}${colors.reset}`)
      }
    }

    // Breakdown section
    if (Object.keys(current.breakdown).length > 0) {
      console.log(`\n${colors.bright}Breakdown:${colors.reset}`)
      const sortedBreakdown = Object.entries(current.breakdown)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10) // Top 10 operations

      sortedBreakdown.forEach(([operation, count]) => {
        const percentage = ((count / current.dailyWrites) * 100).toFixed(1)
        console.log(`${colors.blue}- ${operation}:${colors.reset} ${count} writes (${percentage}%)`)
      })
    }

    // Recommendations section
    console.log(`\n${colors.bright}Recommendations:${colors.reset}`)
    recommendations.forEach(rec => {
      console.log(`${rec}`)
    })

    // Additional metrics
    console.log(`\n${colors.bright}Additional Metrics:${colors.reset}`)
    console.log(`${colors.blue}- Hourly Rate:${colors.reset} ${current.hourlyRate} writes/hour`)

    const hoursUntilReset = Math.floor(current.timeToNextReset / 3600)
    const remainingCapacity = DEFAULT_ANALYTICS_CONFIG.dailyLimit - current.dailyWrites
    console.log(`${colors.blue}- Remaining Capacity:${colors.reset} ${remainingCapacity} writes`)

    if (hoursUntilReset > 0 && current.hourlyRate > 0) {
      const safeHourlyRate = Math.floor(remainingCapacity / hoursUntilReset)
      const rateColor = current.hourlyRate > safeHourlyRate ? colors.red : colors.green
      console.log(`${colors.blue}- Safe Hourly Rate:${colors.reset} ${rateColor}${safeHourlyRate} writes/hour${colors.reset}`)
    }

    // Status summary
    console.log(`\n${colors.bright}Status:${colors.reset} ${alertDisplay.color}${status.toUpperCase()}${colors.reset}`)

    // Debug information
    console.log(`\n${colors.bright}Debug Info:${colors.reset}`)
    console.log(`${colors.blue}- KV Namespace:${colors.reset} ${KV_CONFIG.binding}`)
    console.log(`${colors.blue}- Namespace ID:${colors.reset} ${KV_CONFIG.namespaceId}`)
    console.log(`${colors.blue}- Current Time:${colors.reset} ${new Date().toISOString()}`)
    console.log(`${colors.blue}- Data Source:${colors.reset} Production Cloudflare KV via wrangler CLI`)

    process.exit(0)

  } catch (error) {
    console.error(`${colors.red}❌ Error generating KV analytics:${colors.reset}`)
    console.error(error)

    if (error.message?.includes('wrangler') || error.message?.includes('auth')) {
      console.error(`\n${colors.yellow}💡 Troubleshooting steps:${colors.reset}`)
      console.error(`${colors.yellow}1. Install wrangler: npm install -g wrangler${colors.reset}`)
      console.error(`${colors.yellow}2. Authenticate: npx wrangler login${colors.reset}`)
      console.error(`${colors.yellow}3. Verify access: npx wrangler kv namespace list${colors.reset}`)
    }

    process.exit(1)
  }
}

// Run if this is the main script
if (import.meta.url === `file://${process.argv[1]}`) {
  await runKVAnalytics()
}