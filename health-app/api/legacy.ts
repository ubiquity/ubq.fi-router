/**
 * Legacy health API endpoint for compatibility
 */

import { getCachedHealthData } from '../storage/kv.ts'
import type { LegacyHealthResponse } from '../storage/types.ts'

export async function handleLegacyHealthApi(): Promise<Response> {
  try {
    const cachedData = await getCachedHealthData()

    // Convert to legacy format
    const services = Object.values(cachedData.services)
    const plugins = Object.values(cachedData.plugins)

    const healthyServices = services.filter(s => s.healthy).length
    const healthyPlugins = plugins.filter(p => p.healthy).length
    const totalEntities = services.length + plugins.length
    const healthyEntities = healthyServices + healthyPlugins

    const response: LegacyHealthResponse = {
      lastUpdated: cachedData.lastGlobalUpdate,
      services,
      plugins,
      summary: {
        totalServices: services.length,
        healthyServices,
        totalPlugins: plugins.length,
        healthyPlugins,
        overallHealthPercentage: totalEntities > 0 ? Math.round((healthyEntities / totalEntities) * 100) : 0
      }
    }

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Legacy health API error:', error)
    return new Response(JSON.stringify({
      error: 'Failed to get health data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
