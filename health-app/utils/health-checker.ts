/**
 * Health checking utilities for services and plugins
 */

import type { ProxyStatusResponse, ProxyManifestResponse } from '../storage/types.ts'

/**
 * Check service health status
 */
export async function checkServiceHealth(domain: string): Promise<ProxyStatusResponse> {
  try {
    const targetUrl = `https://${domain}`
    const response = await fetch(targetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000)
    })

    const deploymentStatus = response.status === 404 ? 'not-deployed' :
                           response.ok ? 'deployed-healthy' : 'deployed-unhealthy'

    return {
      healthy: response.ok,
      status: response.status,
      statusText: response.statusText,
      deploymentStatus,
      error: response.ok ? undefined :
             response.status === 404 ? 'Domain not deployed yet' :
             `HTTP ${response.status}: ${response.statusText}`,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    console.error(`Service health check failed for ${domain}:`, error)
    return {
      healthy: false,
      status: 0,
      statusText: 'Connection Failed',
      deploymentStatus: 'connection-failed',
      error: error instanceof Error ? error.message : 'Connection failed',
      timestamp: new Date().toISOString()
    }
  }
}

/**
 * Check plugin manifest validity
 */
export async function checkPluginManifest(domain: string): Promise<ProxyManifestResponse> {
  try {
    const manifestUrl = `https://${domain}/manifest.json`
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      return {
        manifestValid: false,
        status: response.status,
        statusText: response.statusText,
        error: `HTTP ${response.status}: ${response.statusText}`,
        timestamp: new Date().toISOString()
      }
    }

    const manifest = await response.json() as any
    const hasRequiredFields = manifest && typeof manifest === 'object' && manifest.name && manifest.description

    return {
      manifestValid: hasRequiredFields,
      status: response.status,
      statusText: response.statusText,
      manifest: hasRequiredFields ? manifest : undefined,
      error: hasRequiredFields ? undefined : 'Missing required fields (name, description)',
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    console.error(`Plugin manifest check failed for ${domain}:`, error)
    return {
      manifestValid: false,
      status: 0,
      statusText: 'Connection Failed',
      error: error instanceof Error ? error.message : 'Manifest fetch failed',
      timestamp: new Date().toISOString()
    }
  }
}

/**
 * Rate limiting utility
 */
export class RateLimiter {
  private lastChecks = new Map<string, number>()
  private readonly RATE_LIMIT_MS = 5 * 60 * 1000 // 5 minutes

  shouldCheck(key: string): boolean {
    const lastCheck = this.lastChecks.get(key)
    if (!lastCheck) return true

    const timeSinceCheck = Date.now() - lastCheck
    return timeSinceCheck > this.RATE_LIMIT_MS
  }

  recordCheck(key: string): void {
    this.lastChecks.set(key, Date.now())
  }

  cleanup(): void {
    const cutoff = Date.now() - this.RATE_LIMIT_MS * 2
    for (const [key, timestamp] of this.lastChecks) {
      if (timestamp < cutoff) {
        this.lastChecks.delete(key)
      }
    }
  }
}

// Global rate limiter instance
export const globalRateLimiter = new RateLimiter()

// Cleanup old entries every 30 minutes
setInterval(() => {
  globalRateLimiter.cleanup()
}, 30 * 60 * 1000)
