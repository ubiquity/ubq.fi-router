import type { ServiceType } from './types'
import { buildDenoUrl, buildPagesUrl, buildPluginUrl, buildPluginPagesUrl, isPluginDomain } from './utils'

/**
 * Route the request based on service availability
 * OPTIMIZED: Streams responses for better performance
 */
export async function routeRequest(request: Request, url: URL, subdomain: string, serviceType: ServiceType, kvNamespace: any, githubToken: string): Promise<Response> {
  switch (serviceType) {
    case "service-deno":
      return await proxyRequest(request, buildDenoUrl(subdomain, url))

    case "service-pages":
      return await proxyRequest(request, buildPagesUrl(subdomain, url))

    case "service-both":
      // Try regular service on Deno first, fallback to Pages on 404
      const denoUrl = buildDenoUrl(subdomain, url)
      const denoResponse = await proxyRequest(request, denoUrl)

      if (denoResponse.status === 404) {
        // Important: consume the body to free up resources
        await denoResponse.arrayBuffer()
        return await proxyRequest(request, buildPagesUrl(subdomain, url))
      }

      return denoResponse

    case "plugin-deno":
      return await proxyRequest(request, await buildPluginUrl(url.hostname, url, kvNamespace, githubToken))

    case "plugin-pages":
      return await proxyRequest(request, await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken))

    case "plugin-both":
      // Try plugin on Deno first, fallback to plugin on Pages on 404
      const pluginDenoUrl = await buildPluginUrl(url.hostname, url, kvNamespace, githubToken)
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
