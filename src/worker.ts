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
    throw error
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
    throw error
  }
}
