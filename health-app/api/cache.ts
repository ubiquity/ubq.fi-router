/**
 * Get cached health data endpoint
 */

import { getCachedHealthData } from '../storage/kv.ts'

export async function handleGetCache(): Promise<Response> {
  try {
    const cachedData = await getCachedHealthData()

    return new Response(JSON.stringify(cachedData), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // Short cache - client will manage freshness
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Error getting cached health:', error)
    return new Response(JSON.stringify({
      error: 'Failed to get cached health',
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
