import type { ServiceType } from './types'
import { buildDenoUrl, buildPagesUrl, buildPluginUrl, buildPluginPagesUrl, isPluginDomain } from './utils'
import { kvGetWithFallback } from './utils/kv-fallback-wrapper'
import { rateLimitedKVWrite } from './utils/rate-limited-kv-write'

/**
 * Route the request based on service availability
 * OPTIMIZED: Streams responses for better performance
 */
export async function routeRequest(request: Request, url: URL, subdomain: string, serviceType: ServiceType, kvNamespace: any, githubToken: string): Promise<Response> {
  const isIndex = isIndexPath(url)
  switch (serviceType) {
    case "service-deno":
      return isIndex
        ? await proxyRequestWithIndexFallback(request, buildDenoUrl(subdomain, url), null, url, kvNamespace)
        : await proxyRequest(request, buildDenoUrl(subdomain, url))

    case "service-pages":
      return isIndex
        ? await proxyRequestWithIndexFallback(request, buildPagesUrl(subdomain, url), null, url, kvNamespace)
        : await proxyRequest(request, buildPagesUrl(subdomain, url))

    case "service-both":
      // Try regular service on Deno first, fallback to Pages on 404
      const denoUrl = buildDenoUrl(subdomain, url)
      if (isIndex) {
        // For index requests, try Deno with timeout → Pages → KV fallback
        return await proxyRequestWithIndexFallback(request, denoUrl, buildPagesUrl(subdomain, url), url, kvNamespace)
      }
      const denoResponse = await proxyRequest(request, denoUrl)

      if (denoResponse.status === 404) {
        // Important: consume the body to free up resources
        await denoResponse.arrayBuffer()
        return await proxyRequest(request, buildPagesUrl(subdomain, url))
      }

      return denoResponse

    case "plugin-deno":
      if (isIndex) {
        const primary = await buildPluginUrl(url.hostname, url, kvNamespace, githubToken)
        return await proxyRequestWithIndexFallback(request, primary, null, url, kvNamespace)
      }
      return await proxyRequest(request, await buildPluginUrl(url.hostname, url, kvNamespace, githubToken))

    case "plugin-pages":
      if (isIndex) {
        const primary = await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken)
        return await proxyRequestWithIndexFallback(request, primary, null, url, kvNamespace)
      }
      return await proxyRequest(request, await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken))

    case "plugin-both":
      // Try plugin on Deno first, fallback to plugin on Pages on 404
      const pluginDenoUrl = await buildPluginUrl(url.hostname, url, kvNamespace, githubToken)
      if (isIndex) {
        const pluginPagesUrl = await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken)
        return await proxyRequestWithIndexFallback(request, pluginDenoUrl, pluginPagesUrl, url, kvNamespace)
      }
      const pluginDenoResponse = await proxyRequest(request, pluginDenoUrl)

      if (pluginDenoResponse.status === 404) {
        // Important: consume the body to free up resources
        await pluginDenoResponse.arrayBuffer()
        return await proxyRequest(request, await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken))
      }

      return pluginDenoResponse

    case "service-none":
    case "plugin-none":
    default:
      return new Response('Service not found', { status: 404 })
  }
}

/**
 * Proxy the request to the target URL
 * OPTIMIZED: Pass through response without buffering for streaming
 */
async function proxyRequest(request: Request, targetUrl: string): Promise<Response> {
  // Create new request with target URL but preserve original request properties
  const modifiedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual'
  })

  const response = await fetch(modifiedRequest)

  // Return response directly to enable streaming
  // Cloudflare Workers will automatically stream the response body
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

/**
 * Determine if the request targets the index document
 */
function isIndexPath(url: URL): boolean {
  const p = url.pathname
  return p === '/' || p === '' || p === '/index.html'
}

/**
 * Proxy with resilient index fallback:
 * - For index requests, try primary with short timeout
 * - If it fails/5xx, try secondary (if provided)
 * - If still failing, serve last-known-good HTML from KV
 * - On success (2xx HTML), persist HTML to KV as LKG
 */
async function proxyRequestWithIndexFallback(
  request: Request,
  primaryUrl: string,
  secondaryUrl: string | null,
  url: URL,
  kvNamespace: any
): Promise<Response> {
  const INDEX_KEY = `lkg:index:${url.hostname}`
  const TIMEOUT_MS = 3500

  // Helper to perform a timed fetch
  async function timedProxy(target: string): Promise<Response | null> {
    try {
      const modified = new Request(target, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      const res = await fetch(modified)
      return res
    } catch (err) {
      // Network/timeout failure
      console.warn(`Index timed fetch failed for ${target}:`, err)
      return null
    }
  }

  // 1) Try primary
  let res = await timedProxy(primaryUrl)

  // 2) If primary 5xx/timeout, optionally try secondary
  if (!res || res.status >= 500) {
    if (secondaryUrl) {
      res = await timedProxy(secondaryUrl)
    }
  }

  // 3) If we got a valid 2xx, stream it and update KV in background
  if (res && res.status >= 200 && res.status < 300) {
    // Clone to read body for KV without breaking streaming
    const clone = res.clone()
    // Best effort KV write, don't block response
    clone
      .text()
      .then(async (html) => {
        // Only cache plausible HTML
        const ct = res.headers.get('content-type') || ''
        if (html && (ct.includes('text/html') || html.includes('<html'))) {
          await rateLimitedKVWrite(kvNamespace, INDEX_KEY, html, 'index-lkg-write', { expirationTtl: 60 * 60 * 24 * 7 }) // 7d TTL
        }
      })
      .catch(() => {})

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    })
  }

  // 4) Primary/secondary failed → serve last-known-good from KV
  try {
    const html = await kvGetWithFallback(kvNamespace, INDEX_KEY, { type: 'text' as any })
    if (html) {
      const headers = new Headers({
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
        'X-Fallback': 'kv-index'
      })
      return new Response(html, { status: 200, headers })
    }
  } catch (err) {
    console.error('KV read failed for index fallback:', err)
  }

  // 5) Nothing cached → minimal static placeholder
  const placeholder = `<!doctype html><html><head><meta charset="utf-8"><title>UBQ.FI</title></head><body><h1>UBQ.FI</h1><p>We are experiencing issues upstream. This is a cached-safe placeholder for the homepage.</p></body></html>`
  return new Response(placeholder, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
      'X-Fallback': 'static-index'
    }
  })
}
