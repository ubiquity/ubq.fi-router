interface Env {
  ROUTER_CACHE: KVNamespace
  GITHUB_TOKEN?: string
}

interface HealthCheckResult {
  healthy: boolean
  status: number
  error?: string
  lastChecked: string
  checkedBy?: string
}

interface ServiceHealth extends HealthCheckResult {
  name: string
  domain: string
  serviceType?: string
  denoExists?: boolean
  pagesExists?: boolean
}

interface PluginHealth extends HealthCheckResult {
  name: string
  variant: string
  domain: string
  manifestValid?: boolean
}

interface CachedHealthData {
  services: { [key: string]: ServiceHealth }
  plugins: { [key: string]: PluginHealth }
  lastGlobalUpdate: string
}

interface ServicesListResponse {
  services: string[]
  plugins: { name: string; variants: string[] }[]
  timestamp: string
}

export async function handleHealthApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  try {
    // Handle different health API endpoints
    if (path === '/health/services') {
      return handleGetServicesList(env)
    } else if (path === '/health/cache') {
      return handleGetCachedHealth(env)
    } else if (path === '/health/update') {
      return handleUpdateHealth(request, env)
    } else if (path === '/health/proxy/status') {
      return handleProxyStatus(url, env)
    } else if (path === '/health/proxy/manifest') {
      return handleProxyManifest(url, env)
    } else if (path === '/json') {
      // Legacy endpoint - return cached data formatted as before
      return handleLegacyHealthApi(env)
    }

    return new Response('Not found', { status: 404 })
  } catch (error) {
    console.error('Health API error:', error)
    return new Response(JSON.stringify({
      error: 'Health API error',
      message: (error as Error).message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

async function handleGetServicesList(env: Env): Promise<Response> {
  const { getCachedSitemapEntries } = await import('../sitemap-discovery')
  const { getCachedPluginMapEntries } = await import('../plugin-map-discovery')
  const githubToken = env.GITHUB_TOKEN || ''

  try {
    // Get working services from sitemap.json
    const sitemapEntries = await getCachedSitemapEntries(env.ROUTER_CACHE, false, githubToken)

    // Get working plugins from plugin-map.json
    const pluginMapEntries = await getCachedPluginMapEntries(env.ROUTER_CACHE, false, githubToken)

    // Extract service names from sitemap (these are confirmed working)
    const services = sitemapEntries
      .filter(entry => entry.serviceType?.startsWith('service-'))
      .map(entry => {
        const url = new URL(entry.url)
        const subdomain = url.hostname.replace('.ubq.fi', '')
        return subdomain === 'ubq' ? '' : subdomain // root domain is empty string
      })
      .filter((service, index, arr) => arr.indexOf(service) === index) // unique

    // Extract plugin data from plugin-map (these are confirmed working)
    const plugins = pluginMapEntries.map(plugin => ({
      name: plugin.pluginName,
      url: plugin.url,
      routingDomain: plugin.url.replace('https://', '').replace('http://', ''),
      variants: ['main'], // Only include main variant since these are working
      displayName: plugin.displayName,
      description: plugin.description
    }))

    const response: ServicesListResponse = {
      services,
      plugins,
      timestamp: new Date().toISOString()
    }

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Error getting services list:', error)
    return new Response(JSON.stringify({ error: 'Failed to get services list' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

async function handleGetCachedHealth(env: Env): Promise<Response> {
  try {
    const cachedData = await env.ROUTER_CACHE.get('health:cache')

    if (!cachedData) {
      return new Response(JSON.stringify({
        services: {},
        plugins: {},
        lastGlobalUpdate: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    return new Response(cachedData, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', // Short cache - client will manage freshness
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Error getting cached health:', error)
    return new Response(JSON.stringify({ error: 'Failed to get cached health' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

async function handleUpdateHealth(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const updateData = await request.json() as {
      type: 'service' | 'plugin'
      key: string
      result: HealthCheckResult
    }

    try {
      // Get current cached data
      const cachedDataRaw = await env.ROUTER_CACHE.get('health:cache')
      let cachedData: CachedHealthData = cachedDataRaw ? JSON.parse(cachedDataRaw) : {
        services: {},
        plugins: {},
        lastGlobalUpdate: new Date().toISOString()
      }

      // Update the specific entry
      if (updateData.type === 'service') {
        cachedData.services[updateData.key] = updateData.result as ServiceHealth
      } else {
        cachedData.plugins[updateData.key] = updateData.result as PluginHealth
      }

      cachedData.lastGlobalUpdate = new Date().toISOString()

      // Store back to cache
      await env.ROUTER_CACHE.put('health:cache', JSON.stringify(cachedData), {
        expirationTtl: 24 * 60 * 60 // 24 hours
      })

      return new Response(JSON.stringify({
        success: true,
        storage: 'kv',
        timestamp: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })

    } catch (kvError: any) {
      // Handle KV limit errors gracefully
      if (kvError.message?.includes('429') || kvError.message?.includes('limit')) {
        console.log('KV limits hit, suggesting localStorage fallback')
        return new Response(JSON.stringify({
          success: false,
          storage: 'fallback',
          reason: 'kv_limits',
          message: 'KV limits exceeded, use localStorage fallback',
          data: updateData,
          timestamp: new Date().toISOString()
        }), {
          status: 202, // Accepted but using fallback
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }
      throw kvError // Re-throw other KV errors
    }

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

async function handleProxyStatus(url: URL, env: Env): Promise<Response> {
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
    const targetUrl = `https://${domain}`
    const response = await fetch(targetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000)
    })

    const deploymentStatus = response.status === 404 ? 'not-deployed' :
                           response.ok ? 'deployed-healthy' : 'deployed-unhealthy'

    return new Response(JSON.stringify({
      healthy: response.ok,
      status: response.status,
      statusText: response.statusText,
      deploymentStatus,
      error: response.ok ? null :
             response.status === 404 ? 'Domain not deployed yet' :
             `HTTP ${response.status}: ${response.statusText}`,
      timestamp: new Date().toISOString()
    }), {
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

async function handleProxyManifest(url: URL, env: Env): Promise<Response> {
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
    const manifestUrl = `https://${domain}/manifest.json`
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
      return new Response(JSON.stringify({
        manifestValid: false,
        status: response.status,
        statusText: response.statusText,
        error: `HTTP ${response.status}: ${response.statusText}`,
        timestamp: new Date().toISOString()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const manifest = await response.json() as any
    const hasRequiredFields = manifest && typeof manifest === 'object' && manifest.name && manifest.description

    return new Response(JSON.stringify({
      manifestValid: hasRequiredFields,
      status: response.status,
      statusText: response.statusText,
      manifest: hasRequiredFields ? manifest : null,
      error: hasRequiredFields ? null : 'Missing required fields (name, description)',
      timestamp: new Date().toISOString()
    }), {
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

async function handleLegacyHealthApi(env: Env): Promise<Response> {
  try {
    const cachedDataRaw = await env.ROUTER_CACHE.get('health:cache')
    if (!cachedDataRaw) {
      return new Response(JSON.stringify({
        lastUpdated: new Date().toISOString(),
        services: [],
        plugins: [],
        summary: {
          totalServices: 0,
          healthyServices: 0,
          totalPlugins: 0,
          healthyPlugins: 0,
          overallHealthPercentage: 0
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const cachedData: CachedHealthData = JSON.parse(cachedDataRaw)

    // Convert to legacy format
    const services = Object.values(cachedData.services)
    const plugins = Object.values(cachedData.plugins)

    const healthyServices = services.filter(s => s.healthy).length
    const healthyPlugins = plugins.filter(p => p.healthy).length
    const totalEntities = services.length + plugins.length
    const healthyEntities = healthyServices + healthyPlugins

    return new Response(JSON.stringify({
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
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error) {
    console.error('Legacy health API error:', error)
    return new Response(JSON.stringify({ error: 'Failed to get health data' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
