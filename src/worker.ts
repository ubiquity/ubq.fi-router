/**
 * UBQ.FI Router - Main worker entry point
 * Routes requests from ubq.fi domains to Deno Deploy or Cloudflare Pages
 */

import type { ServiceType, CacheControlValue } from './types'
import { getSubdomainKey } from './utils'
import { coalesceDiscovery } from './service-discovery'
import { routeRequest } from './routing'
import { getCachedSitemapEntries } from './sitemap-discovery'
import { generateXmlSitemap, generateJsonSitemap, createXmlResponse, createJsonResponse } from './sitemap-generator'
import { getCachedPluginMapEntries } from './plugin-map-discovery'
import { generateXmlPluginMap, generateJsonPluginMap, createXmlPluginMapResponse, createJsonPluginMapResponse } from './plugin-map-generator'
import { handleHealthApi } from './health-dashboard/api'

interface Env {
  ROUTER_CACHE: KVNamespace
  GITHUB_TOKEN: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  // Validate required environment variables
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN environment variable is required but not found')
  }

  const url = new URL(request.url)
  const cacheControl = request.headers.get('X-Cache-Control') as CacheControlValue

  // Handle sitemap endpoints
  if (url.pathname === '/sitemap.xml') {
    return await handleSitemapXml(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN)
  }

  if (url.pathname === '/sitemap.json') {
    return await handleSitemapJson(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN)
  }

  // Handle plugin-map endpoints
  if (url.pathname === '/plugin-map.xml') {
    return await handlePluginMapXml(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN)
  }

  if (url.pathname === '/plugin-map.json') {
    return await handlePluginMapJson(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN)
  }

  // Handle health JSON endpoint
  if (url.pathname === '/json') {
    return await handleHealthApi(request, env)
  }

  // Generate cache key from hostname
  const subdomain = getSubdomainKey(url.hostname)

  // Handle health dashboard (health.ubq.fi)
  if (subdomain === 'health' && url.pathname === '/') {
    return await handleHealthDashboard()
  }
  const cacheKey = `route:${subdomain}`

  // Handle cache control headers
  if (cacheControl === 'clear') {
    await env.ROUTER_CACHE.delete(cacheKey)
    return new Response('Cache cleared', { status: 200 })
  }

  if (cacheControl === 'clear-all') {
    // Clear all route cache entries
    const { keys } = await env.ROUTER_CACHE.list({ prefix: 'route:' })
    const deletePromises = keys.map(key => env.ROUTER_CACHE.delete(key.name))
    await Promise.all(deletePromises)
    return new Response(`Cleared ${keys.length} cache entries`, { status: 200 })
  }

  let serviceType: ServiceType

  if (cacheControl === 'refresh') {
    // Force refresh: skip cache and discover services
    serviceType = await coalesceDiscovery(subdomain, url, env.ROUTER_CACHE, env.GITHUB_TOKEN)
    const ttl = (serviceType === 'service-none' || serviceType === 'plugin-none') ? 300 : 3600 // 5 min for 404s, 1 hour for existing
    await env.ROUTER_CACHE.put(cacheKey, serviceType, { expirationTtl: ttl })
  } else {
    // Normal flow: check cache first
    const cachedServiceType = await env.ROUTER_CACHE.get(cacheKey)
    serviceType = cachedServiceType as ServiceType

    if (!serviceType) {
      // Cache miss: discover and cache services with coalescing
      serviceType = await coalesceDiscovery(subdomain, url, env.ROUTER_CACHE, env.GITHUB_TOKEN)
      const ttl = (serviceType === 'service-none' || serviceType === 'plugin-none') ? 300 : 3600 // 5 min for 404s, 1 hour for existing
      await env.ROUTER_CACHE.put(cacheKey, serviceType, { expirationTtl: ttl })
    }
  }

  // Route based on discovered/cached service availability
  return await routeRequest(request, url, subdomain, serviceType, env.ROUTER_CACHE, env.GITHUB_TOKEN)
}

/**
 * Safe sitemap generation with timeout
 */
async function safeSitemapGeneration(kvNamespace: KVNamespace, forceRefresh: boolean, githubToken: string): Promise<any[]> {
  const TIMEOUT_MS = 8000 // 8 seconds timeout (within 10s worker limit)

  console.log('🚀 Starting sitemap generation with timeout protection')

  // Race between sitemap generation and timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Sitemap generation timeout')), TIMEOUT_MS)
  })

  const sitemapPromise = getCachedSitemapEntries(kvNamespace, forceRefresh, githubToken)

  const entries = await Promise.race([sitemapPromise, timeoutPromise]) as any[]

  console.log(`✅ Sitemap generation completed with ${entries.length} entries`)
  return entries
}

/**
 * Handle XML sitemap requests
 */
async function handleSitemapXml(kvNamespace: KVNamespace, forceRefresh: boolean, githubToken: string): Promise<Response> {
  try {
    const entries = await safeSitemapGeneration(kvNamespace, forceRefresh, githubToken)
    const xmlContent = generateXmlSitemap(entries)
    return createXmlResponse(xmlContent)
  } catch (error) {
    console.error('Critical error in XML sitemap handler:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Sitemap XML error: ${errorMessage}`, { status: 500 })
  }
}

/**
 * Handle JSON sitemap requests
 */
async function handleSitemapJson(kvNamespace: KVNamespace, forceRefresh: boolean, githubToken: string): Promise<Response> {
  try {
    const entries = await safeSitemapGeneration(kvNamespace, forceRefresh, githubToken)
    const jsonContent = generateJsonSitemap(entries)
    return createJsonResponse(jsonContent)
  } catch (error) {
    console.error('Critical error in JSON sitemap handler:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Sitemap JSON error: ${errorMessage}`, { status: 500 })
  }
}

/**
 * Safe plugin-map generation with timeout
 */
async function safePluginMapGeneration(kvNamespace: KVNamespace, forceRefresh: boolean, githubToken: string): Promise<any[]> {
  const TIMEOUT_MS = 8000 // 8 seconds timeout (within 10s worker limit)

  console.log('🚀 Starting plugin-map generation with timeout protection')

  // Race between plugin-map generation and timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Plugin-map generation timeout')), TIMEOUT_MS)
  })

  const pluginMapPromise = getCachedPluginMapEntries(kvNamespace, forceRefresh, githubToken)

  const entries = await Promise.race([pluginMapPromise, timeoutPromise]) as any[]

  console.log(`✅ Plugin-map generation completed with ${entries.length} entries`)
  return entries
}

/**
 * Handle XML plugin-map requests
 */
async function handlePluginMapXml(kvNamespace: KVNamespace, forceRefresh: boolean, githubToken: string): Promise<Response> {
  try {
    const entries = await safePluginMapGeneration(kvNamespace, forceRefresh, githubToken)
    const xmlContent = generateXmlPluginMap(entries)
    return createXmlPluginMapResponse(xmlContent)
  } catch (error) {
    console.error('Critical error in XML plugin-map handler:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Plugin-map XML error: ${errorMessage}`, { status: 500 })
  }
}

/**
 * Handle JSON plugin-map requests
 */
async function handlePluginMapJson(kvNamespace: KVNamespace, forceRefresh: boolean, githubToken: string): Promise<Response> {
  try {
    const entries = await safePluginMapGeneration(kvNamespace, forceRefresh, githubToken)
    const jsonContent = generateJsonPluginMap(entries)
    return createJsonPluginMapResponse(jsonContent)
  } catch (error) {
    console.error('Critical error in JSON plugin-map handler:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Plugin-map JSON error: ${errorMessage}`, { status: 500 })
  }
}

/**
 * Handle health dashboard requests
 */
async function handleHealthDashboard(): Promise<Response> {
  // Read the HTML file from the health-dashboard directory
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UBQ.FI Health Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            min-height: 100vh;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }

        .header {
            text-align: center;
            margin-bottom: 3rem;
        }

        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .header p {
            color: #94a3b8;
            font-size: 1.1rem;
        }

        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }

        .summary-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 0.75rem;
            padding: 1.5rem;
            text-align: center;
            transition: all 0.2s;
        }

        .summary-card:hover {
            border-color: #475569;
            transform: translateY(-2px);
        }

        .summary-card h3 {
            font-size: 0.875rem;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }

        .summary-card .value {
            font-size: 2rem;
            font-weight: 700;
            color: #f8fafc;
            margin-bottom: 0.25rem;
        }

        .summary-card .label {
            color: #64748b;
            font-size: 0.875rem;
        }

        .health-percentage {
            background: linear-gradient(135deg, #10b981, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .section {
            margin-bottom: 3rem;
        }

        .section h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: #f8fafc;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1rem;
        }

        .service-card, .plugin-card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 0.5rem;
            padding: 1rem;
            transition: all 0.2s;
        }

        .service-card:hover, .plugin-card:hover {
            border-color: #475569;
        }

        .card-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 0.75rem;
        }

        .card-title {
            font-weight: 600;
            color: #f8fafc;
        }

        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-left: auto;
        }

        .status-healthy {
            background-color: #10b981;
        }

        .status-unhealthy {
            background-color: #ef4444;
        }

        .card-domain {
            color: #94a3b8;
            font-size: 0.875rem;
            margin-bottom: 0.5rem;
        }

        .card-details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem;
            font-size: 0.75rem;
        }

        .detail-item {
            display: flex;
            justify-content: space-between;
        }

        .detail-label {
            color: #64748b;
        }

        .detail-value {
            color: #f8fafc;
        }

        .loading {
            text-align: center;
            padding: 3rem;
            color: #94a3b8;
        }

        .error {
            background: #7f1d1d;
            border: 1px solid #dc2626;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 2rem;
            color: #fecaca;
        }

        .last-updated {
            text-align: center;
            color: #64748b;
            font-size: 0.875rem;
            margin-top: 2rem;
        }

        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .summary {
                grid-template-columns: 1fr;
            }
            
            .grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>UBQ.FI Health Dashboard</h1>
            <p>Real-time status monitoring for all UBQ.FI services and plugins</p>
        </div>

        <div id="loading" class="loading">
            <p>Loading health data...</p>
        </div>

        <div id="error" class="error" style="display: none;"></div>

        <div id="content" style="display: none;">
            <div class="summary">
                <div class="summary-card">
                    <h3>Overall Health</h3>
                    <div class="value health-percentage" id="overall-health">0%</div>
                    <div class="label">System Health</div>
                </div>
                <div class="summary-card">
                    <h3>Services</h3>
                    <div class="value" id="services-count">0/0</div>
                    <div class="label">Healthy Services</div>
                </div>
                <div class="summary-card">
                    <h3>Plugins</h3>
                    <div class="value" id="plugins-count">0/0</div>
                    <div class="label">Healthy Plugins</div>
                </div>
                <div class="summary-card">
                    <h3>Last Updated</h3>
                    <div class="value" id="last-updated" style="font-size: 1rem;">Never</div>
                    <div class="label">Refresh Time</div>
                </div>
            </div>

            <div class="section">
                <h2>Services Status</h2>
                <div class="grid" id="services-grid"></div>
            </div>

            <div class="section">
                <h2>Plugins Status</h2>
                <div class="grid" id="plugins-grid"></div>
            </div>

            <div class="last-updated">
                Data refreshes automatically every 5 minutes
            </div>
        </div>
    </div>

    <script>
        async function fetchHealthData() {
            try {
                const response = await fetch('/json')
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`)
                }
                return await response.json()
            } catch (error) {
                console.error('Failed to fetch health data:', error)
                throw error
            }
        }

        function updateSummary(data) {
            document.getElementById('overall-health').textContent = \`\${data.summary.overallHealthPercentage}%\`
            document.getElementById('services-count').textContent = \`\${data.summary.healthyServices}/\${data.summary.totalServices}\`
            document.getElementById('plugins-count').textContent = \`\${data.summary.healthyPlugins}/\${data.summary.totalPlugins}\`
            document.getElementById('last-updated').textContent = new Date(data.lastUpdated).toLocaleTimeString()
        }

        function createServiceCard(service) {
            return \`
                <div class="service-card">
                    <div class="card-header">
                        <div class="card-title">\${service.name || 'root'}</div>
                        <div class="status-indicator \${service.healthy ? 'status-healthy' : 'status-unhealthy'}"></div>
                    </div>
                    <div class="card-domain">\${service.domain}</div>
                    <div class="card-details">
                        <div class="detail-item">
                            <span class="detail-label">Type:</span>
                            <span class="detail-value">\${service.serviceType}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">\${service.status}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Deno:</span>
                            <span class="detail-value">\${service.denoExists ? 'Yes' : 'No'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Pages:</span>
                            <span class="detail-value">\${service.pagesExists ? 'Yes' : 'No'}</span>
                        </div>
                    </div>
                    \${service.error ? \`<div style="color: #ef4444; font-size: 0.75rem; margin-top: 0.5rem;">\${service.error}</div>\` : ''}
                </div>
            \`
        }

        function createPluginCard(plugin) {
            return \`
                <div class="plugin-card">
                    <div class="card-header">
                        <div class="card-title">\${plugin.name}</div>
                        <div class="status-indicator \${plugin.healthy ? 'status-healthy' : 'status-unhealthy'}"></div>
                    </div>
                    <div class="card-domain">\${plugin.domain}</div>
                    <div class="card-details">
                        <div class="detail-item">
                            <span class="detail-label">Variant:</span>
                            <span class="detail-value">\${plugin.variant}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value">\${plugin.status}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Manifest:</span>
                            <span class="detail-value">\${plugin.manifestValid ? 'Valid' : 'Invalid'}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Updated:</span>
                            <span class="detail-value">\${new Date(plugin.lastChecked).toLocaleTimeString()}</span>
                        </div>
                    </div>
                    \${plugin.error ? \`<div style="color: #ef4444; font-size: 0.75rem; margin-top: 0.5rem;">\${plugin.error}</div>\` : ''}
                </div>
            \`
        }

        function updateContent(data) {
            updateSummary(data)

            // Update services
            const servicesGrid = document.getElementById('services-grid')
            servicesGrid.innerHTML = data.services.map(createServiceCard).join('')

            // Update plugins
            const pluginsGrid = document.getElementById('plugins-grid')
            pluginsGrid.innerHTML = data.plugins.map(createPluginCard).join('')
        }

        function showError(message) {
            document.getElementById('loading').style.display = 'none'
            document.getElementById('content').style.display = 'none'
            const errorDiv = document.getElementById('error')
            errorDiv.textContent = \`Error: \${message}\`
            errorDiv.style.display = 'block'
        }

        function showContent() {
            document.getElementById('loading').style.display = 'none'
            document.getElementById('error').style.display = 'none'
            document.getElementById('content').style.display = 'block'
        }

        async function loadHealthData() {
            try {
                const data = await fetchHealthData()
                updateContent(data)
                showContent()
            } catch (error) {
                showError(error.message)
            }
        }

        // Load initial data
        loadHealthData()

        // Refresh every 5 minutes
        setInterval(loadHealthData, 5 * 60 * 1000)

        // Manual refresh on click
        document.addEventListener('click', (e) => {
            if (e.target.id === 'overall-health') {
                loadHealthData()
            }
        })
    </script>
</body>
</html>
  `

  return new Response(htmlContent, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
    }
  })
}
