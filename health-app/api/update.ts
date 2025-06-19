/**
 * Update health data endpoint
 */

import { updateHealthData } from '../storage/kv.ts'
import type { UpdateHealthRequest } from '../storage/types.ts'

export async function handleUpdateHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const updateData = await request.json() as UpdateHealthRequest

    const result = await updateHealthData(updateData)

    if (!result.success) {
      return new Response(JSON.stringify({
        success: false,
        storage: 'fallback',
        reason: 'storage_error',
        message: result.error || 'Failed to update health data',
        timestamp: result.timestamp
      }), {
        status: 202, // Accepted but with issues
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })

  } catch (error) {
    console.error('Error updating health:', error)
    return new Response(JSON.stringify({
      error: 'Failed to update health',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
