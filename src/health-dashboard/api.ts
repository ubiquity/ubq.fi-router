interface Env {
  ROUTER_CACHE: KVNamespace
  GITHUB_TOKEN?: string
}

interface HealthResponse {
  lastUpdated: string
  services: ServiceHealth[]
  plugins: PluginHealth[]
  summary: {
    totalServices: number
    healthyServices: number
    totalPlugins: number
    healthyPlugins: number
    overallHealthPercentage: number
  }
}

interface ServiceHealth {
  name: string
  domain: string
  serviceType: string
  healthy: boolean
  status: number
  error?: string
  denoExists: boolean
  pagesExists: boolean
  lastChecked: string
}

interface PluginHealth {
  name: string
  variant: string
  domain: string
  healthy: boolean
  status: number
  manifestValid: boolean
  error?: string
  lastChecked: string
}

interface GitHubWorkflowRun {
  id: number
  conclusion: string
  created_at: string
  updated_at: string
  html_url: string
  status: string
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRun[]
}

export async function handleHealthApi(request: Request, env: Env): Promise<Response> {
  try {
    // Check if we have cached health data
    const cachedData = await env.ROUTER_CACHE.get('health:latest')
    
    if (cachedData) {
      const data = JSON.parse(cachedData)
      
      // If cache is less than 10 minutes old, return it
      const cacheAge = Date.now() - new Date(data.lastUpdated).getTime()
      if (cacheAge < 10 * 60 * 1000) { // 10 minutes
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300', // Cache for 5 minutes in browser
            'Access-Control-Allow-Origin': '*'
          }
        })
      }
    }
    
    // Fetch fresh data from GitHub Actions
    const healthData = await fetchHealthFromGitHub(env)
    
    // Cache the result for 10 minutes
    await env.ROUTER_CACHE.put('health:latest', JSON.stringify(healthData), {
      expirationTtl: 600 // 10 minutes
    })
    
    return new Response(JSON.stringify(healthData), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes in browser
        'Access-Control-Allow-Origin': '*'
      }
    })
    
  } catch (error) {
    console.error('Health API error:', error)
    
    // Try to return cached data even if it's older
    const cachedData = await env.ROUTER_CACHE.get('health:latest')
    if (cachedData) {
      return new Response(cachedData, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60', // Short cache on error
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    
    // Return error response
    return new Response(JSON.stringify({
      error: 'Failed to fetch health data',
      message: (error as Error).message,
      lastUpdated: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}

async function fetchHealthFromGitHub(env: Env): Promise<HealthResponse> {
  // For now, simulate health data by running the same validation logic as our tests
  // In a real implementation, this would fetch from GitHub Actions API or stored results
  
  const { getKnownServices, getKnownPlugins } = await import('../utils')
  const { coalesceDiscovery } = await import('../service-discovery')
  const { buildPluginUrl } = await import('../utils')
  
  const githubToken = env.GITHUB_TOKEN || ''
  
  // Get services
  const knownServices = await getKnownServices(env.ROUTER_CACHE, githubToken)
  const servicesToTest = ["", ...knownServices] // Include root domain
  
  const services: ServiceHealth[] = []
  
  for (const subdomain of servicesToTest) {
    try {
      const domain = subdomain ? `${subdomain}.ubq.fi` : 'ubq.fi'
      const url = new URL(`https://${domain}`)
      
      // Run service discovery
      const serviceType = await coalesceDiscovery(subdomain, url, env.ROUTER_CACHE, githubToken)
      
      // Check if domain works
      const domainResult = await checkDomain(domain)
      
      services.push({
        name: subdomain || 'root',
        domain,
        serviceType,
        healthy: domainResult.healthy,
        status: domainResult.status,
        error: domainResult.error,
        denoExists: serviceType.includes('deno'),
        pagesExists: serviceType.includes('pages'),
        lastChecked: new Date().toISOString()
      })
    } catch (error) {
      services.push({
        name: subdomain || 'root',
        domain: subdomain ? `${subdomain}.ubq.fi` : 'ubq.fi',
        serviceType: 'service-none',
        healthy: false,
        status: 0,
        error: (error as Error).message,
        denoExists: false,
        pagesExists: false,
        lastChecked: new Date().toISOString()
      })
    }
  }
  
  // Get plugins
  const knownPlugins = await getKnownPlugins(env.ROUTER_CACHE, githubToken)
  const plugins: PluginHealth[] = []
  
  for (const plugin of knownPlugins) {
    const variants = ['main', 'development']
    
    for (const variant of variants) {
      try {
        const pluginDomain = variant === 'main' 
          ? `os-${plugin}.ubq.fi` 
          : `os-${plugin}-${variant}.ubq.fi`
        
        const url = new URL(`https://${pluginDomain}`)
        const targetUrl = await buildPluginUrl(pluginDomain, url, env.ROUTER_CACHE, githubToken)
        
        // Check manifest
        const manifestResult = await checkPluginManifest(targetUrl)
        
        // Check domain
        const domainResult = await checkDomain(pluginDomain)
        
        plugins.push({
          name: `${plugin}-${variant}`,
          variant,
          domain: pluginDomain,
          healthy: domainResult.healthy && manifestResult.valid,
          status: domainResult.status,
          manifestValid: manifestResult.valid,
          error: domainResult.error,
          lastChecked: new Date().toISOString()
        })
      } catch (error) {
        plugins.push({
          name: `${plugin}-${variant}`,
          variant,
          domain: `os-${plugin}${variant === 'main' ? '' : `-${variant}`}.ubq.fi`,
          healthy: false,
          status: 0,
          manifestValid: false,
          error: (error as Error).message,
          lastChecked: new Date().toISOString()
        })
      }
    }
  }
  
  // Calculate summary
  const healthyServices = services.filter(s => s.healthy).length
  const healthyPlugins = plugins.filter(p => p.healthy).length
  const totalEntities = services.length + plugins.length
  const healthyEntities = healthyServices + healthyPlugins
  
  return {
    lastUpdated: new Date().toISOString(),
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
}

async function checkDomain(domain: string): Promise<{ healthy: boolean; status: number; error?: string }> {
  try {
    const response = await fetch(`https://${domain}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000)
    })
    
    return {
      healthy: response.status >= 200 && response.status < 400,
      status: response.status
    }
  } catch (error) {
    return {
      healthy: false,
      status: 0,
      error: (error as Error).message
    }
  }
}

async function checkPluginManifest(targetUrl: string): Promise<{ valid: boolean }> {
  try {
    const baseUrl = new URL(targetUrl).origin
    const manifestUrl = `${baseUrl}/manifest.json`
    
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
      return { valid: false }
    }

    const manifest = await response.json() as any
    const hasRequiredFields = manifest.name && manifest.description

    return { valid: hasRequiredFields }
  } catch (error) {
    return { valid: false }
  }
}
