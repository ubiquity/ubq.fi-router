/**
 * UBQ.FI Router - Main worker entry point
 * Routes requests from ubq.fi domains to Deno Deploy or Cloudflare Pages
 */

import type { ServiceType, CacheControlValue } from './types'
import { getSubdomainKey, isPluginDomain } from './utils'
import { coalesceDiscovery } from './service-discovery'
import { routeRequest } from './routing'
import { getCachedSitemapEntries } from './sitemap-discovery'
import { generateXmlSitemap, generateJsonSitemap, createXmlResponse, createJsonResponse } from './sitemap-generator'
import { getCachedPluginMapEntries } from './plugin-map-discovery'
import { generateXmlPluginMap, generateJsonPluginMap, createXmlPluginMapResponse, createJsonPluginMapResponse } from './plugin-map-generator'
import { rateLimitedKVWrite } from './utils/rate-limited-kv-write'
import { kvGetWithFallback, kvDeleteWithFallback, kvListWithFallback } from './utils/kv-fallback-wrapper'
import { routeServiceTypeCache } from './core/memory-cache'
import { getLastKnownGoodPlatform, setLastKnownGoodPlatform, clearLastKnownGoodPlatform } from './core/last-known-good'
import { discoverAllServices, discoverAllPlugins } from './core/discovery'

interface Env {
  ROUTER_CACHE: KVNamespace
  GITHUB_TOKEN: string
  ADMIN_TOKEN?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  // DIAGNOSTIC LOG: Test if ANY logs appear in wrangler tail
  console.log(JSON.stringify({
    level: "DEBUG",
    message: "🔍 DIAGNOSTIC: Worker fetch handler started",
    timestamp: new Date().toISOString(),
    url: request.url,
    method: request.method,
    userAgent: request.headers.get('User-Agent'),
    cfRay: request.headers.get('CF-Ray')
  }));

  // Github token is optional for normal routing; required only for sitemap/plugin-map generation

  const url = new URL(request.url)
  const cacheControl = request.headers.get('X-Cache-Control') as CacheControlValue

  // Lightweight health endpoint for monitoring
  if (url.pathname === '/__health') {
    return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
  }

  // Handle RPC requests early to avoid preflight issues
  if (url.pathname.startsWith('/rpc/')) {
    return await handleRpcRequest(request, url)
  }

  // Admin: platform pinning API
  if (url.pathname === '/__platform') {
    return await handlePlatformAdmin(request, env, url)
  }

  if (url.pathname === '/__seed-lkg') {
    return await handleSeedLKG(request, env, url)
  }

  // Handle sitemap endpoints
  if (url.pathname === '/sitemap.xml') {
    return await handleSitemapXml(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN, request)
  }

  if (url.pathname === '/sitemap.json') {
    return await handleSitemapJson(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN, request)
  }

  // Handle plugin-map endpoints
  if (url.pathname === '/plugin-map.xml') {
    return await handlePluginMapXml(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN, request)
  }

  if (url.pathname === '/plugin-map.json') {
    return await handlePluginMapJson(env.ROUTER_CACHE, cacheControl === 'refresh', env.GITHUB_TOKEN, request)
  }

  // Generate cache key from hostname
  const subdomain = getSubdomainKey(url.hostname)
  const cacheKey = `route:${subdomain}`

  // Handle cache control headers
  if (cacheControl === 'clear') {
    await kvDeleteWithFallback(env.ROUTER_CACHE, cacheKey)
    return new Response('Cache cleared', { status: 200 })
  }

  if (cacheControl === 'clear-all') {
    // Clear all route cache entries
    const { keys } = await kvListWithFallback(env.ROUTER_CACHE, { prefix: 'route:' })
    const deletePromises = keys.map(key => kvDeleteWithFallback(env.ROUTER_CACHE, key.name))
    await Promise.all(deletePromises)
    return new Response(`Cleared ${keys.length} cache entries`, { status: 200 })
  }

  let serviceType: ServiceType

  if (cacheControl === 'refresh') {
    console.log(JSON.stringify({
      level: "INFO",
      message: `Cache refresh triggered for ${request.url}`,
      url: request.url,
      sourceIp: request.headers.get('CF-Connecting-IP'),
      userAgent: request.headers.get('User-Agent'),
      referer: request.headers.get('Referer'),
      headers: Object.fromEntries(request.headers),
    }));
    // Force refresh: skip cache and discover services
    serviceType = await coalesceDiscovery(subdomain, url, env.ROUTER_CACHE, env.GITHUB_TOKEN)
    // Cache policy: do not cache negative results for long
    const isNegative = serviceType === 'service-none' || serviceType === 'plugin-none'
    const expirationTtl = isNegative ? 60 : 86400 // 1 minute for NONE, 24h otherwise
    if (!isNegative) {
      await rateLimitedKVWrite(env.ROUTER_CACHE, cacheKey, serviceType, 'route-refresh', { expirationTtl })
    }
  } else {
    // Normal flow: zero-KV hot path. Assume both platforms; routing logic will pick working backend.
    const isPlugin = url.hostname.split('.')[0].startsWith('os-')
    serviceType = (isPlugin ? 'plugin-both' : 'service-both') as ServiceType
  }

  // Route based on discovered/cached service availability
  return await routeRequest(request, url, subdomain, serviceType, env.ROUTER_CACHE, env.GITHUB_TOKEN)
}

async function handlePlatformAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const adminToken = env.ADMIN_TOKEN || ''
  const headerToken = request.headers.get('X-Admin-Token') || ''
  if (!adminToken || headerToken !== adminToken) {
    return new Response('Forbidden', { status: 403 })
  }
  const host = url.searchParams.get('host') || ''
  if (!host || !(host === 'ubq.fi' || host.endsWith('.ubq.fi'))) {
    return new Response('Missing or invalid host', { status: 400 })
  }
  const isPlugin = isPluginDomain(host)
  const id = isPlugin ? host : getSubdomainKey(host)

  if (request.method === 'GET') {
    const lkg = await getLastKnownGoodPlatform(env.ROUTER_CACHE, isPlugin, id)
    return json({ host, isPlugin, id, platform: lkg || null })
  }
  if (request.method === 'DELETE') {
    await clearLastKnownGoodPlatform(env.ROUTER_CACHE, isPlugin, id)
    return json({ host, cleared: true })
  }
  if (request.method === 'POST' || request.method === 'PUT') {
    const platform = url.searchParams.get('platform')
    if (platform !== 'deno' && platform !== 'pages') {
      return new Response('platform must be deno|pages', { status: 400 })
    }
    await setLastKnownGoodPlatform(env.ROUTER_CACHE, isPlugin, id, platform)
    return json({ host, isPlugin, id, platform, set: true })
  }
  return new Response('Method Not Allowed', { status: 405 })
}

function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function handleSeedLKG(request: Request, env: Env, url: URL): Promise<Response> {
  const adminToken = env.ADMIN_TOKEN || ''
  const headerToken = request.headers.get('X-Admin-Token') || ''
  if (!adminToken || headerToken !== adminToken) {
    return new Response('Forbidden', { status: 403 })
  }
  const which = url.searchParams.get('which') || 'all'
  const out: any = { which, services: { set: 0 }, plugins: { set: 0 } }
  try {
    if (which === 'services' || which === 'all') {
      const svcMap = await discoverAllServices(env.ROUTER_CACHE, env.GITHUB_TOKEN)
      for (const [sub, type] of svcMap) {
        let platform: 'deno' | 'pages' | null = null
        if (type === 'service-deno') platform = 'deno'
        else if (type === 'service-pages' || type === 'service-both') platform = 'pages'
        if (platform) {
          await setLastKnownGoodPlatform(env.ROUTER_CACHE, false, sub, platform)
          out.services.set++
        }
      }
    }
    if (which === 'plugins' || which === 'all') {
      const plugMap = await discoverAllPlugins(env.ROUTER_CACHE, env.GITHUB_TOKEN)
      for (const [plugin, { serviceType } ] of plugMap) {
        let platform: 'deno' | 'pages' | null = null
        if (serviceType === 'plugin-deno' || serviceType === 'plugin-both') platform = 'deno'
        else if (serviceType === 'plugin-pages') platform = 'pages'
        if (platform) {
          const host = `os-${plugin}.ubq.fi`
          await setLastKnownGoodPlatform(env.ROUTER_CACHE, true, host, platform)
          out.plugins.set++
        }
      }
    }
    return json(out)
  } catch (e: any) {
    return json({ error: e?.message || String(e), partial: out }, 500)
  }
}

/**
 * Handle RPC requests by proxying to rpc.ubq.fi
 * This eliminates CORS preflight requests by making them same-origin
 */
async function handleRpcRequest(request: Request, url: URL): Promise<Response> {
  console.log(JSON.stringify({
    level: "INFO",
    message: "🔗 Handling RPC request",
    url: request.url,
    method: request.method,
    path: url.pathname
  }));

  // Extract chain ID from path /rpc/{chain_id}
  const pathParts = url.pathname.split('/')
  if (pathParts.length < 3 || pathParts[1] !== 'rpc') {
    return new Response('Invalid RPC path format. Use /rpc/{chain_id}', { status: 400 })
  }

  const chainId = pathParts[2]

  // Validate chain ID is numeric
  if (!chainId || !/^\d+$/.test(chainId)) {
    return new Response('Invalid chain ID. Must be numeric.', { status: 400 })
  }

  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400', // 24 hours
      }
    })
  }

  // Construct target RPC URL
  const targetUrl = `https://rpc.ubq.fi/${chainId}${url.search}`

  try {
    // Create headers for the proxied request, excluding host-specific headers
    const proxyHeaders = new Headers()
    for (const [key, value] of request.headers.entries()) {
      // Skip host-specific headers that could cause issues
      if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
        proxyHeaders.set(key, value)
      }
    }

    // Create the proxied request
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      redirect: 'manual'
    })

    // Make the request to the actual RPC endpoint
    const response = await fetch(proxyRequest)

    // Create response headers with CORS
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    // Return the response with streaming body
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    })

  } catch (error) {
    console.error('RPC proxy error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`RPC proxy error: ${errorMessage}`, {
      status: 502,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain'
      }
    })
  }
}

/**
 * Safe sitemap generation with timeout
 */
async function safeSitemapGeneration(
  kvNamespace: KVNamespace,
  forceRefresh: boolean,
  githubToken: string,
  request?: any
  ): Promise<any[]> {
  const TIMEOUT_MS = 8000 // 8 seconds timeout (within 10s worker limit)

  console.log('🚀 Starting sitemap generation with timeout protection')

  // Race between sitemap generation and timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Sitemap generation timeout')), TIMEOUT_MS)
  })

  const sitemapPromise = getCachedSitemapEntries(kvNamespace, forceRefresh, githubToken, request)

  const entries = await Promise.race([sitemapPromise, timeoutPromise]) as any[]

  console.log(`✅ Sitemap generation completed with ${entries.length} entries`)
  return entries
}

/**
 * Handle XML sitemap requests
 */
async function handleSitemapXml(
  kvNamespace: KVNamespace,
  forceRefresh: boolean,
  githubToken: string,
  request?: any
  ): Promise<Response> {
  try {
    const entries = await safeSitemapGeneration(kvNamespace, forceRefresh, githubToken, request)
    const xmlContent = generateXmlSitemap(entries)
    return createXmlResponse(xmlContent)
  } catch (error) {
    console.error('Critical error in XML sitemap handler:', error)
    // Attempt to serve last cached content as a best-effort fallback
    try {
      const entries = await getCachedSitemapEntries(kvNamespace, false, githubToken, request)
      const xmlContent = generateXmlSitemap(entries)
      return createXmlResponse(xmlContent)
    } catch {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Sitemap XML error: ${errorMessage}`, { status: 503 })
    }
  }
}

/**
 * Handle JSON sitemap requests
 */
async function handleSitemapJson(
  kvNamespace: KVNamespace,
  forceRefresh: boolean,
  githubToken: string,
  request?: any
  ): Promise<Response> {
  try {
    const entries = await safeSitemapGeneration(kvNamespace, forceRefresh, githubToken, request)
    const jsonContent = generateJsonSitemap(entries)
    return createJsonResponse(jsonContent)
  } catch (error) {
    console.error('Critical error in JSON sitemap handler:', error)
    // Attempt to serve last cached content as a best-effort fallback
    try {
      const entries = await getCachedSitemapEntries(kvNamespace, false, githubToken, request)
      const jsonContent = generateJsonSitemap(entries)
      return createJsonResponse(jsonContent)
    } catch {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Sitemap JSON error: ${errorMessage}`, { status: 503 })
    }
  }
}

/**
 * Safe plugin-map generation with timeout
 */
async function safePluginMapGeneration(
  kvNamespace: KVNamespace,
  forceRefresh: boolean,
  githubToken: string,
  request?: any
  ): Promise<any[]> {
  const TIMEOUT_MS = 8000 // 8 seconds timeout (within 10s worker limit)

  console.log('🚀 Starting plugin-map generation with timeout protection')

  // Race between plugin-map generation and timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Plugin-map generation timeout')), TIMEOUT_MS)
  })

  const pluginMapPromise = getCachedPluginMapEntries(kvNamespace, forceRefresh, githubToken, request)

  const entries = await Promise.race([pluginMapPromise, timeoutPromise]) as any[]

  console.log(`✅ Plugin-map generation completed with ${entries.length} entries`)
  return entries
}

/**
 * Handle XML plugin-map requests
 */
async function handlePluginMapXml(
  kvNamespace: KVNamespace,
  forceRefresh: boolean,
  githubToken: string,
  request?: any
  ): Promise<Response> {
  try {
    const entries = await safePluginMapGeneration(kvNamespace, forceRefresh, githubToken, request)
    const xmlContent = generateXmlPluginMap(entries)
    return createXmlPluginMapResponse(xmlContent)
  } catch (error) {
    console.error('Critical error in XML plugin-map handler:', error)
    // Attempt to serve last cached content as a best-effort fallback
    try {
      const entries = await getCachedPluginMapEntries(kvNamespace, false, githubToken, request)
      const xmlContent = generateXmlPluginMap(entries)
      return createXmlPluginMapResponse(xmlContent)
    } catch {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Plugin-map XML error: ${errorMessage}`, { status: 503 })
    }
  }
}

/**
 * Handle JSON plugin-map requests
 */
async function handlePluginMapJson(
  kvNamespace: KVNamespace,
  forceRefresh: boolean,
  githubToken: string,
  request?: any
  ): Promise<Response> {
  try {
    const entries = await safePluginMapGeneration(kvNamespace, forceRefresh, githubToken, request)
    const jsonContent = generateJsonPluginMap(entries, new Date().toISOString())
    return createJsonPluginMapResponse(jsonContent)
  } catch (error) {
    console.error('Critical error in JSON plugin-map handler:', error)
    // Attempt to serve last cached content as a best-effort fallback
    try {
      const entries = await getCachedPluginMapEntries(kvNamespace, false, githubToken, request)
      const jsonContent = generateJsonPluginMap(entries, new Date().toISOString())
      return createJsonPluginMapResponse(jsonContent)
    } catch {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Plugin-map JSON error: ${errorMessage}`, { status: 503 })
    }
  }
}
