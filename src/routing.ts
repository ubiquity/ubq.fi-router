import type { ServiceType } from './types'
import { buildDenoUrl, buildPagesUrl, buildPluginUrl, buildPluginPagesUrl, isPluginDomain } from './utils'
import { getLastKnownGoodPlatform, setLastKnownGoodPlatform } from './core/last-known-good'
import { isCircuitOpen, recordFailure, recordSuccess } from './core/circuit-breaker'

/**
 * Route the request based on service availability
 * OPTIMIZED: Streams responses for better performance
 */
export async function routeRequest(request: Request, url: URL, subdomain: string, serviceType: ServiceType, kvNamespace: any, githubToken: string): Promise<Response> {
  const isPlugin = isPluginDomain(url.hostname)
  const id = isPlugin ? url.hostname : subdomain
  // Decide try order using last-known-good platform for faster success path
  let primary: 'deno' | 'pages' | null = null
  try {
    const lkg = await getLastKnownGoodPlatform(kvNamespace, isPlugin, id)
    if (lkg === 'deno' || lkg === 'pages') primary = lkg
  } catch {}
  // Per-host cookie hint (ubqpf)
  const cookiePref = getCookie(request, 'ubqpf')
  if (cookiePref === 'deno' || cookiePref === 'pages') {
    primary = cookiePref
  }
  switch (serviceType) {
    case "service-deno": {
      // Prefer Deno; fallback to Pages on 404/5xx/errors
      const denoFirst = primary ? primary === 'deno' : true
      let firstUrl = denoFirst ? buildDenoUrl(subdomain, url) : buildPagesUrl(subdomain, url)
      let secondUrl = denoFirst ? buildPagesUrl(subdomain, url) : buildDenoUrl(subdomain, url)
      // Avoid suppressed platform as primary when possible
      {
        const p1 = platformOf(firstUrl)
        const p2 = platformOf(secondUrl)
        if (isCircuitOpen(id, p1) && !isCircuitOpen(id, p2)) {
          const tmp = firstUrl; firstUrl = secondUrl; secondUrl = tmp
        }
      }
      try {
        const resp = await proxyAndRecord(request, firstUrl, id)
        if (resp.status === 404 || resp.status >= 500) {
          await resp.arrayBuffer()
          const fallback = await proxyAndRecord(request, secondUrl, id)
          if (fallback.status < 500 && fallback.status !== 404) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'pages' : 'deno')
          }
          return fallback
        }
        // Success path -> record LKG
        await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'deno' : 'pages')
        return addPlatformCookie(resp, denoFirst ? 'deno' : 'pages', url.hostname)
      } catch {
        const fb = await proxyAndRecord(request, secondUrl, id)
        if (fb.status < 500 && fb.status !== 404) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'pages' : 'deno')
          return addPlatformCookie(fb, denoFirst ? 'pages' : 'deno', url.hostname)
        }
        return fb
      }
    }

    case "service-pages": {
      // Prefer Pages; fallback to Deno on 404/5xx/errors
      const pagesFirst = primary ? primary === 'pages' : true
      let firstUrl = pagesFirst ? buildPagesUrl(subdomain, url) : buildDenoUrl(subdomain, url)
      let secondUrl = pagesFirst ? buildDenoUrl(subdomain, url) : buildPagesUrl(subdomain, url)
      // Avoid suppressed platform as primary when possible
      {
        const p1 = platformOf(firstUrl)
        const p2 = platformOf(secondUrl)
        if (isCircuitOpen(id, p1) && !isCircuitOpen(id, p2)) {
          const tmp = firstUrl; firstUrl = secondUrl; secondUrl = tmp
        }
      }
      try {
        const resp = await proxyAndRecord(request, firstUrl, id)
        if (resp.status === 404 || resp.status >= 500) {
          await resp.arrayBuffer()
          const fallback = await proxyAndRecord(request, secondUrl, id)
          if (fallback.status < 500 && fallback.status !== 404) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, pagesFirst ? 'deno' : 'pages')
          }
          return fallback
        }
        await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, pagesFirst ? 'pages' : 'deno')
        return addPlatformCookie(resp, pagesFirst ? 'pages' : 'deno', url.hostname)
      } catch {
        const fb = await proxyAndRecord(request, secondUrl, id)
        if (fb.status < 500 && fb.status !== 404) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, pagesFirst ? 'deno' : 'pages')
          return addPlatformCookie(fb, pagesFirst ? 'deno' : 'pages', url.hostname)
        }
        return fb
      }
    }

    case "service-both": {
      // Try with hedging when no primary; otherwise prefer primary and fallback
      const denoFirst = primary ? primary === 'deno' : true
      let firstUrl = denoFirst ? buildDenoUrl(subdomain, url) : buildPagesUrl(subdomain, url)
      let secondUrl = denoFirst ? buildPagesUrl(subdomain, url) : buildDenoUrl(subdomain, url)

      // Hedged path for GET/HEAD when primary unknown
      if (!primary && (request.method === 'GET' || request.method === 'HEAD')) {
        // If one platform is suppressed, avoid hedging and try the other
        const p1 = platformOf(firstUrl)
        const p2 = platformOf(secondUrl)
        const p1Open = isCircuitOpen(id, p1)
        const p2Open = isCircuitOpen(id, p2)
        if (p1Open && !p2Open) {
          const r = await proxyAndRecord(request, secondUrl, id)
          const ok = r.status < 500 && r.status !== 404
          if (ok) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, p2)
            return addPlatformCookie(r, p2, url.hostname)
          }
          return r
        }
        if (p2Open && !p1Open) {
          const r = await proxyAndRecord(request, firstUrl, id)
          const ok = r.status < 500 && r.status !== 404
          if (ok) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, p1)
            return addPlatformCookie(r, p1, url.hostname)
          }
          return r
        }
        const res = await hedgedProxy(request, firstUrl, secondUrl, 250)
        const ok = res.status < 500 && res.status !== 404
        if (ok) {
          const platform: 'deno' | 'pages' = res.headers.get('x-upstream-platform') === 'deno' ? 'deno' : 'pages'
          try { recordSuccess(id, platform) } catch {}
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, platform)
          return addPlatformCookie(res, platform, url.hostname)
        }
        try {
          const p = res.headers.get('x-upstream-platform') === 'deno' ? 'deno' : 'pages'
          recordFailure(id, p)
        } catch {}
        return res
      }

      try {
        const firstResp = await proxyAndRecord(request, firstUrl, id)
        if (firstResp.status === 404 || firstResp.status >= 500) {
          // Consume body to free resources before fallback
          await firstResp.arrayBuffer()
          const fallback = await proxyAndRecord(request, secondUrl, id)
          if (fallback.status < 500 && fallback.status !== 404) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'pages' : 'deno')
          }
          return fallback
        }
        await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'deno' : 'pages')
        return addPlatformCookie(firstResp, denoFirst ? 'deno' : 'pages', url.hostname)
      } catch {
        // Network/other error -> fallback
        const fb = await proxyAndRecord(request, secondUrl, id)
        if (fb.status < 500 && fb.status !== 404) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'pages' : 'deno')
          return addPlatformCookie(fb, denoFirst ? 'pages' : 'deno', url.hostname)
        }
        return fb
      }
    }

    case "plugin-deno": {
      // Prefer Deno plugin; fallback to Pages
      const denoFirst = primary ? primary === 'deno' : true
      let firstUrl = denoFirst ? await buildPluginUrl(url.hostname, url, kvNamespace, githubToken) : await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken)
      let secondUrl = denoFirst ? await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken) : await buildPluginUrl(url.hostname, url, kvNamespace, githubToken)
      // Avoid suppressed platform as primary when possible
      {
        const p1 = platformOf(firstUrl)
        const p2 = platformOf(secondUrl)
        if (isCircuitOpen(id, p1) && !isCircuitOpen(id, p2)) {
          const tmp = firstUrl; firstUrl = secondUrl; secondUrl = tmp
        }
      }
      try {
        const resp = await proxyAndRecord(request, firstUrl, id)
        if (resp.status === 404 || resp.status >= 500) {
          await resp.arrayBuffer()
          const fallback = await proxyAndRecord(request, secondUrl, id)
          if (fallback.status < 500 && fallback.status !== 404) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'pages' : 'deno')
          }
          return fallback
        }
        await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'deno' : 'pages')
        return resp
      } catch {
        const fb = await proxyAndRecord(request, secondUrl, id)
        if (fb.status < 500 && fb.status !== 404) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, denoFirst ? 'pages' : 'deno')
        }
        return fb
      }
    }

    case "plugin-pages": {
      // Prefer Pages plugin; fallback to Deno
      const pagesFirst = primary ? primary === 'pages' : true
      let firstUrl = pagesFirst ? await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken) : await buildPluginUrl(url.hostname, url, kvNamespace, githubToken)
      let secondUrl = pagesFirst ? await buildPluginUrl(url.hostname, url, kvNamespace, githubToken) : await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken)
      // Avoid suppressed platform as primary when possible
      {
        const p1 = platformOf(firstUrl)
        const p2 = platformOf(secondUrl)
        if (isCircuitOpen(id, p1) && !isCircuitOpen(id, p2)) {
          const tmp = firstUrl; firstUrl = secondUrl; secondUrl = tmp
        }
      }
      try {
        const resp = await proxyAndRecord(request, firstUrl, id)
        if (resp.status === 404 || resp.status >= 500) {
          await resp.arrayBuffer()
          const fallback = await proxyAndRecord(request, secondUrl, id)
          if (fallback.status < 500 && fallback.status !== 404) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, pagesFirst ? 'deno' : 'pages')
          }
          return fallback
        }
        await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, pagesFirst ? 'pages' : 'deno')
        return addPlatformCookie(resp, pagesFirst ? 'pages' : 'deno', url.hostname)
      } catch {
        const fb = await proxyAndRecord(request, secondUrl, id)
        if (fb.status < 500 && fb.status !== 404) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, pagesFirst ? 'deno' : 'pages')
          return addPlatformCookie(fb, pagesFirst ? 'deno' : 'pages', url.hostname)
        }
        return fb
      }
    }

    case "plugin-both": {
      // Try plugin on Deno first; hedge GETs when no primary
      const pluginDenoUrl = await buildPluginUrl(url.hostname, url, kvNamespace, githubToken)
      const pluginPagesUrl = await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken)

      if (!primary && (request.method === 'GET' || request.method === 'HEAD')) {
        // If one platform is suppressed, avoid hedging and try the other
        const p1Open = isCircuitOpen(id, 'deno')
        const p2Open = isCircuitOpen(id, 'pages')
        if (p1Open && !p2Open) {
          const r = await proxyAndRecord(request, pluginPagesUrl, id)
          const ok = r.status < 500 && r.status !== 404
          if (ok) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, 'pages')
            return addPlatformCookie(r, 'pages', url.hostname)
          }
          return r
        }
        if (p2Open && !p1Open) {
          const r = await proxyAndRecord(request, pluginDenoUrl, id)
          const ok = r.status < 500 && r.status !== 404
          if (ok) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, 'deno')
            return addPlatformCookie(r, 'deno', url.hostname)
          }
          return r
        }
        const res = await hedgedProxy(request, pluginDenoUrl, pluginPagesUrl, 250)
        const ok = res.status < 500 && res.status !== 404
        if (ok) {
          const platform: 'deno' | 'pages' = res.headers.get('x-upstream-platform') === 'deno' ? 'deno' : 'pages'
          try { recordSuccess(id, platform) } catch {}
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, platform)
          return addPlatformCookie(res, platform, url.hostname)
        }
        try {
          const p = res.headers.get('x-upstream-platform') === 'deno' ? 'deno' : 'pages'
          recordFailure(id, p)
        } catch {}
        return res
      }
      try {
        const pluginDenoResp = await proxyAndRecord(request, pluginDenoUrl, id)
        if (pluginDenoResp.status === 404 || pluginDenoResp.status >= 500) {
          await pluginDenoResp.arrayBuffer()
          const fb = await proxyAndRecord(request, await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken), id)
          if (fb.status < 500 && fb.status !== 404) {
            await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, 'pages')
            return addPlatformCookie(fb, 'pages', url.hostname)
          }
          return fb
        }
        await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, 'deno')
        return addPlatformCookie(pluginDenoResp, 'deno', url.hostname)
      } catch {
        const fb = await proxyAndRecord(request, await buildPluginPagesUrl(url.hostname, url, kvNamespace, githubToken), id)
        if (fb.status < 500 && fb.status !== 404) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, 'pages')
          return addPlatformCookie(fb, 'pages', url.hostname)
        }
        return fb
      }
    }

    case "service-none":
    case "plugin-none":
    default: {
      // Even if discovery says none, try both quickly before 404
      let firstUrl = primary === 'pages' ? buildPagesUrl(subdomain, url) : buildDenoUrl(subdomain, url)
      let secondUrl = primary === 'pages' ? buildDenoUrl(subdomain, url) : buildPagesUrl(subdomain, url)
      // Avoid suppressed platform as primary when possible
      {
        const p1 = platformOf(firstUrl)
        const p2 = platformOf(secondUrl)
        if (isCircuitOpen(id, p1) && !isCircuitOpen(id, p2)) {
          const tmp = firstUrl; firstUrl = secondUrl; secondUrl = tmp
        }
      }
      try {
        const first = await proxyAndRecord(request, firstUrl, id)
        if (first.status !== 404 && first.status < 500) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, primary === 'pages' ? 'pages' : 'deno')
          return addPlatformCookie(first, primary === 'pages' ? 'pages' : 'deno', url.hostname)
        }
      } catch {}
      try {
        const second = await proxyAndRecord(request, secondUrl, id)
        if (second.status !== 404 && second.status < 500) {
          await setLastKnownGoodPlatform(kvNamespace, isPlugin, id, primary === 'pages' ? 'deno' : 'pages')
          return addPlatformCookie(second, primary === 'pages' ? 'deno' : 'pages', url.hostname)
        }
      } catch {}
      return new Response('Service not found', { status: 404 })
    }
  }
}

/**
 * Proxy the request to the target URL
 * OPTIMIZED: Pass through response without buffering for streaming
 */
async function proxyRequest(request: Request, targetUrl: string, timeoutMs: number = 6000): Promise<Response> {
  // Prepare sanitized headers to avoid host/origin issues
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'origin' || k === 'referer' || k === 'cf-ray' || k === 'cookie') continue
    headers.set(key, value)
  }

  // Clone the request up-front to support retries/fallbacks
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual'
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Use a fresh clone stream so we can retry/fallback safely
    init.body = request.clone().body
  }
  const reqForTarget = new Request(targetUrl, init)

  const response = await fetch(reqForTarget, { signal: AbortSignal.timeout(timeoutMs) })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

// Wrap proxy with simple circuit-breaker accounting
async function proxyAndRecord(request: Request, targetUrl: string, id: string, timeoutMs: number = 6000): Promise<Response> {
  const platform = platformOf(targetUrl)
  try {
    const resp = await proxyRequest(request, targetUrl, timeoutMs)
    if (resp.status >= 500) {
      try { recordFailure(id, platform) } catch {}
    } else if (resp.status !== 404) {
      try { recordSuccess(id, platform) } catch {}
    }
    return resp
  } catch (e) {
    try { recordFailure(id, platform) } catch {}
    throw e
  }
}

function platformOf(url: string): 'deno' | 'pages' {
  return url.includes('deno.dev') ? 'deno' : 'pages'
}

async function hedgedProxy(
  request: Request,
  firstUrl: string,
  secondUrl: string,
  hedgeDelayMs: number = 250,
  timeoutMs: number = 6000
): Promise<Response> {
  // Only safe for GET/HEAD; callsites ensure this
  let p1Resolved = false
  const p1 = (async () => {
    const r = await proxyRequest(request, firstUrl, timeoutMs)
    p1Resolved = true
    const h = new Headers(r.headers)
    h.set('x-upstream-platform', platformOf(firstUrl))
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h })
  })()

  let p2: Promise<Response> | null = null
  const startSecond = () => {
    if (!p2) {
      p2 = (async () => {
        const r = await proxyRequest(request, secondUrl, timeoutMs)
        const h = new Headers(r.headers)
        h.set('x-upstream-platform', platformOf(secondUrl))
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h })
      })()
    }
  }

  await Promise.race([
    p1.then(() => 'p1'),
    new Promise((res) => setTimeout(() => res('timer'), hedgeDelayMs))
  ]).then((winner) => {
    if (winner === 'timer' && !p1Resolved) startSecond()
  })

  const ok = (r: Response) => r.status !== 404 && r.status < 500

  if (p2) {
    const first = await Promise.race([p1, p2])
    if (ok(first)) return first
    const other = first === (await Promise.resolve(p1)) ? await p2 : await p1
    if (ok(other)) return other
    return first
  }

  return await p1
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie') || request.headers.get('Cookie')
  if (!cookie) return null
  const parts = cookie.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

function addPlatformCookie(resp: Response, platform: 'deno' | 'pages', host: string): Response {
  try {
    if (resp.status >= 400) return resp
    const headers = new Headers(resp.headers)
    const cookie = `ubqpf=${platform}; Max-Age=86400; Path=/; Domain=${host}; Secure; SameSite=Lax`
    headers.append('Set-Cookie', cookie)
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers })
  } catch {
    return resp
  }
}
