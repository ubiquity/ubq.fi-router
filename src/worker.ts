/**
 * UBQ.FI Router - Main worker entry point
 * Routes requests from ubq.fi domains to Deno Deploy or Cloudflare Pages
 */

import type { ServiceType, CacheControlValue } from './types'
import { getSubdomainKey } from './utils'
import { coalesceDiscovery } from './service-discovery'
import { routeRequest } from './routing'

interface Env {
  ROUTER_CACHE: KVNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const cacheControl = request.headers.get('X-Cache-Control') as CacheControlValue

  // Generate cache key from hostname
  const subdomain = getSubdomainKey(url.hostname)
  const cacheKey = `route:${subdomain}`

  // Handle cache control headers
  if (cacheControl === 'clear') {
    await env.ROUTER_CACHE.delete(cacheKey)
    return new Response('Cache cleared', { status: 200 })
  }

  let serviceType: ServiceType

  if (cacheControl === 'refresh') {
    // Force refresh: skip cache and discover services
    serviceType = await coalesceDiscovery(subdomain, url)
    const ttl = serviceType === 'none' ? 300 : 3600 // 5 min for 404s, 1 hour for existing
    await env.ROUTER_CACHE.put(cacheKey, serviceType, { expirationTtl: ttl })
  } else {
    // Normal flow: check cache first
    const cachedServiceType = await env.ROUTER_CACHE.get(cacheKey)
    serviceType = cachedServiceType as ServiceType

    if (!serviceType) {
      // Cache miss: discover and cache services with coalescing
      serviceType = await coalesceDiscovery(subdomain, url)
      const ttl = serviceType === 'none' ? 300 : 3600 // 5 min for 404s, 1 hour for existing
      await env.ROUTER_CACHE.put(cacheKey, serviceType, { expirationTtl: ttl })
    }
  }

  // Route based on discovered/cached service availability
  return await routeRequest(request, url, subdomain, serviceType)
}
