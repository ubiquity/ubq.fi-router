/**
 * Services list endpoint
 */

import { getServicesFromRouter } from '../utils/router-api.ts'

export async function handleGetServices(): Promise<Response> {
  try {
    const services = await getServicesFromRouter()

    return new Response(JSON.stringify(services), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Error getting services list:', error)
    return new Response(JSON.stringify({
      error: 'Failed to get services list',
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
