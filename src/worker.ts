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
import { rateLimitedKVWrite } from './utils/rate-limited-kv-write'

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

  // Validate required environment variables
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN environment variable is required but not found')
  }

  const url = new URL(request.url)
  const cacheControl = request.headers.get('X-Cache-Control') as CacheControlValue

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
    // Cache good results for 1 hour, negative results for 5 minutes
    const expirationTtl = serviceType === 'service-none' || serviceType === 'plugin-none' ? 300 : 3600
    await rateLimitedKVWrite(env.ROUTER_CACHE, cacheKey, serviceType, 'route-refresh', { expirationTtl })
  } else {
    // Normal flow: check cache first
    const cachedServiceType = await env.ROUTER_CACHE.get(cacheKey)
    serviceType = cachedServiceType as ServiceType

    if (!serviceType) {
      // Cache miss: discover and cache services with coalescing
      serviceType = await coalesceDiscovery(subdomain, url, env.ROUTER_CACHE, env.GITHUB_TOKEN)
      // Cache good results for 1 hour, negative results for 5 minutes
      const expirationTtl = serviceType === 'service-none' || serviceType === 'plugin-none' ? 300 : 3600
      await rateLimitedKVWrite(env.ROUTER_CACHE, cacheKey, serviceType, 'route-cache-miss', { expirationTtl })
    }
  }

  // Route based on discovered/cached service availability
  return await routeRequest(request, url, subdomain, serviceType, env.ROUTER_CACHE, env.GITHUB_TOKEN)
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
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Sitemap XML error: ${errorMessage}`, { status: 500 })
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
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Sitemap JSON error: ${errorMessage}`, { status: 500 })
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
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Plugin-map XML error: ${errorMessage}`, { status: 500 })
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
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(`Plugin-map JSON error: ${errorMessage}`, { status: 500 })
  }
}
