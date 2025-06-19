/**
 * Proxy API endpoints for health checking
 */

import { checkServiceHealth, checkPluginManifest } from '../utils/health-checker.ts'

export async function handleProxyStatus(url: URL): Promise<Response> {
  const domain = url.searchParams.get('domain')
  if (!domain) {
    return new Response(JSON.stringify({ error: 'domain parameter required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  try {
    const result = await checkServiceHealth(domain)

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error(`Proxy status check failed for ${domain}:`, error)

    return new Response(JSON.stringify({
      healthy: false,
      status: 0,
      statusText: 'Connection Failed',
      deploymentStatus: 'connection-failed',
      error: error instanceof Error ? error.message : 'Connection failed',
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // Shorter cache for errors
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

export async function handleProxyManifest(url: URL): Promise<Response> {
  const domain = url.searchParams.get('domain')
  if (!domain) {
    return new Response(JSON.stringify({ error: 'domain parameter required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }

  try {
    const result = await checkPluginManifest(domain)

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error(`Proxy manifest check failed for ${domain}:`, error)

    return new Response(JSON.stringify({
      manifestValid: false,
      status: 0,
      statusText: 'Connection Failed',
      error: error instanceof Error ? error.message : 'Manifest fetch failed',
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // Shorter cache for errors
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
