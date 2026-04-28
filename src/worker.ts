/**
 * UBQ.FI Router — Cloudflare Worker
 * Deterministic routing to Deno Deploy apps; /rpc is same‑origin proxy.
 * Service routes prefer Deno Deploy and fall back to Deploy Classic only when
 * the Deno platform reports the new deployment is missing.
 * No KV, no sticky cookies, no Pages fallback.
 */

import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import {
  DENO_CLASSIC_FALLBACK_WARNING,
  DENO_CLASSIC_MIGRATION_URL,
  DENO_CLASSIC_SUNSET_DATE,
  DENO_CLASSIC_SUNSET_HTTP_DATE,
  type DenoRouteTarget,
  isDenoDeploymentNotFound,
  resolveDenoUrl,
} from './utils/build-deno-url'
import { buildPluginUrl } from './utils/build-plugin-url'

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs (deno/plugin)
  LOG_RPC_SAMPLE?: string   // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
}

type LogKind = 'route' | 'rpc' | 'health'

function parseRate(value: string | undefined, fallback = 0): number {
  const n = Number(value)
  if (Number.isFinite(n)) return Math.min(1, Math.max(0, n))
  return fallback
}

function debugRequested(request: Request, url: URL): boolean {
  const hdr = request.headers.get('x-debug-log')?.toLowerCase()
  const qp = url.searchParams.get('__log')?.toLowerCase()
  return hdr === '1' || hdr === 'true' || qp === '1' || qp === 'true'
}

function shouldLog(kind: LogKind, request: Request, url: URL, env: Env): boolean {
  // Always allow explicit on-demand debugging via header or query param
  if (debugRequested(request, url)) return true
  switch (kind) {
    case 'rpc':
      return Math.random() < parseRate(env.LOG_RPC_SAMPLE, 0)
    case 'health':
      return Math.random() < parseRate(env.LOG_HEALTH_SAMPLE, 0)
    default:
      return Math.random() < parseRate(env.LOG_ROUTE_SAMPLE, 0)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/__health') {
      if (shouldLog('health', request, url, env)) {
        try {
          console.log(JSON.stringify({
            event: 'health',
            t: new Date().toISOString(),
            method: request.method,
            inHost: url.hostname,
            hostHeader: request.headers.get('host') || undefined,
            path: url.pathname,
            cfRay: request.headers.get('cf-ray') || undefined,
          }))
        } catch {}
      }
      return json({ status: 'ok', time: new Date().toISOString() })
    }

    if (url.pathname.startsWith('/rpc/')) {
      return handleRpc(request, url, env)
    }

    const inHost = url.hostname
    const isPlugin = isPluginDomain(inHost)
    const subKey = getSubdomainKey(inHost)
    let denoTarget: DenoRouteTarget | null = null
    let target: string
    if (isPlugin) {
      target = buildPluginUrl(inHost, url)
    } else if (subKey.startsWith('preview-')) {
      target = buildPreviewUrl(subKey, url)
    } else {
      denoTarget = await resolveDenoUrl(subKey, url)
      target = denoTarget.url
    }

    const started = Date.now()
    try {
      const result = await proxyRoute(request, target, inHost, denoTarget)
      const response = result.response
      if (shouldLog('route', request, url, env)) {
        try {
          const log = {
            t: new Date().toISOString(),
            route: isPlugin ? 'plugin' : 'deno',
            method: request.method,
            inHost,
            hostHeader: request.headers.get('host') || undefined,
            path: url.pathname,
            hasQuery: url.search.length > 0,
            target: result.target,
            targetHost: new URL(result.target).hostname,
            denoRouteKind: result.denoRouteKind,
            denoFallbackReason: result.denoFallbackReason,
            status: response.status,
            ms: Date.now() - started,
            workIncoming: inHost === 'work.ubq.fi',
            workTarget: !isPlugin && subKey === 'work',
            cfRay: request.headers.get('cf-ray') || undefined,
          }
          // Structured JSON log for easy filtering in Workers Logs
          console.log(JSON.stringify({ event: 'route', ...log }))
        } catch {}
      }
      return response
    } catch (err) {
      console.error(JSON.stringify({
        event: 'route_error',
        t: new Date().toISOString(),
        route: isPlugin ? 'plugin' : 'deno',
        method: request.method,
        inHost,
        hostHeader: request.headers.get('host') || undefined,
        path: url.pathname,
        target,
        denoRouteKind: denoTarget?.kind,
        denoFallbackReason: denoTarget?.fallbackReason,
        message: err instanceof Error ? err.message : String(err)
      }))
      return new Response('Upstream error', { status: 502 })
    }
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

async function handleRpc(request: Request, url: URL, env: Env): Promise<Response> {
  const parts = url.pathname.split('/')
  const chainId = parts[2]
  if (!chainId || !/^\d+$/.test(chainId)) {
    return new Response('Invalid chain ID. Must be numeric.', { status: 400 })
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400'
      }
    })
  }

  const targetUrl = `https://rpc.ubq.fi/${chainId}${url.search}`
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'origin' || k === 'referer') continue
    headers.set(key, value)
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  }
  const started = Date.now()
  const resp = await fetch(new Request(targetUrl, init))
  const outHeaders = new Headers(resp.headers)
  outHeaders.set('Access-Control-Allow-Origin', '*')
  outHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  outHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  // RPC traffic can be very high-volume; sample heavily by default.
  if (shouldLog('rpc', request, url, env)) {
    try {
      const inHost = new URL(request.url).hostname
      const log = {
        t: new Date().toISOString(),
        route: 'rpc',
        method: request.method,
        inHost,
        hostHeader: request.headers.get('host') || undefined,
        path: url.pathname,
        hasQuery: url.search.length > 0,
        target: targetUrl,
        targetHost: 'rpc.ubq.fi',
        status: resp.status,
        ms: Date.now() - started,
        workIncoming: inHost === 'work.ubq.fi',
        cfRay: request.headers.get('cf-ray') || undefined,
      }
      console.log(JSON.stringify({ event: 'route', ...log }))
    } catch {}
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders })
}

async function proxy(request: Request, targetUrl: string, timeoutMs = 6000): Promise<Response> {
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'origin' || k === 'referer' || k === 'cf-ray' || k === 'cookie') continue
    headers.set(key, value)
  }

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.clone().body
  }
  const res = await fetch(new Request(targetUrl, init), { signal: AbortSignal.timeout(timeoutMs) })
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
}

type RouteProxyResult = Readonly<{
  response: Response
  target: string
  denoRouteKind?: DenoRouteTarget['kind']
  denoFallbackReason?: DenoRouteTarget['fallbackReason']
}>

async function proxyRoute(
  request: Request,
  target: string,
  inHost: string,
  denoTarget: DenoRouteTarget | null,
): Promise<RouteProxyResult> {
  const res = await proxy(request, target)
  if (denoTarget?.kind === 'deno2' && isDenoDeploymentNotFound(res.headers)) {
    try {
      void res.body?.cancel()
    } catch {}

    const fallbackTarget = buildClassicFallbackTarget(denoTarget, 'deno2_deployment_not_found')
    const classicRes = await proxy(request, fallbackTarget.classicUrl)
    if (!isDenoDeploymentNotFound(classicRes.headers)) {
      return {
        response: withDenoClassicFallbackHeaders(classicRes, fallbackTarget),
        target: fallbackTarget.classicUrl,
        denoRouteKind: fallbackTarget.kind,
        denoFallbackReason: fallbackTarget.fallbackReason,
      }
    }

    try {
      void classicRes.body?.cancel()
    } catch {}

    return {
      response: denoClassicUnavailableResponse(inHost, fallbackTarget, classicRes.status),
      target: fallbackTarget.classicUrl,
      denoRouteKind: fallbackTarget.kind,
      denoFallbackReason: fallbackTarget.fallbackReason,
    }
  }

  if (denoTarget?.kind !== 'classic') {
    return {
      response: res,
      target,
      denoRouteKind: denoTarget?.kind,
      denoFallbackReason: denoTarget?.fallbackReason,
    }
  }

  if (isDenoDeploymentNotFound(res.headers)) {
    try {
      void res.body?.cancel()
    } catch {}

    if (denoTarget.fallbackReason === 'deno2_probe_failed') {
      const retryRes = await proxy(request, denoTarget.deno2Url)
      if (!isDenoDeploymentNotFound(retryRes.headers)) {
        return {
          response: retryRes,
          target: denoTarget.deno2Url,
          denoRouteKind: 'deno2',
          denoFallbackReason: denoTarget.fallbackReason,
        }
      }

      try {
        void retryRes.body?.cancel()
      } catch {}
    }

    return {
      response: denoClassicUnavailableResponse(inHost, denoTarget, res.status),
      target,
      denoRouteKind: denoTarget.kind,
      denoFallbackReason: denoTarget.fallbackReason,
    }
  }

  return {
    response: withDenoClassicFallbackHeaders(res, denoTarget),
    target,
    denoRouteKind: denoTarget.kind,
    denoFallbackReason: denoTarget.fallbackReason,
  }
}

function buildClassicFallbackTarget(
  denoTarget: DenoRouteTarget,
  fallbackReason: NonNullable<DenoRouteTarget['fallbackReason']>,
): DenoRouteTarget {
  return {
    url: denoTarget.classicUrl,
    kind: 'classic',
    deno2Url: denoTarget.deno2Url,
    classicUrl: denoTarget.classicUrl,
    fallbackReason,
  }
}

function withDenoClassicFallbackHeaders(res: Response, denoTarget: DenoRouteTarget): Response {
  const headers = new Headers(res.headers)
  setDenoClassicFallbackHeaders(headers, denoTarget)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function denoClassicUnavailableResponse(inHost: string, denoTarget: DenoRouteTarget, upstreamStatus: number): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  setDenoClassicFallbackHeaders(headers, denoTarget)

  return new Response(JSON.stringify({
    error: {
      message:
        `No Deno Deploy app was found for ${inHost}, and the Deno Deploy Classic fallback is unavailable. ` +
        `Deno Deploy Classic shuts down on ${DENO_CLASSIC_SUNSET_DATE}; migrate this service to Deno Deploy.`,
      code: 'deno_classic_fallback_unavailable',
      classic_sunset_date: DENO_CLASSIC_SUNSET_DATE,
      migration_url: DENO_CLASSIC_MIGRATION_URL,
      deno2_target: denoTarget.deno2Url,
      classic_target: denoTarget.classicUrl,
      upstream_status: upstreamStatus,
    },
  }), { status: 503, headers })
}

function setDenoClassicFallbackHeaders(headers: Headers, denoTarget: DenoRouteTarget): void {
  headers.set('Deprecation', 'true')
  headers.set('Sunset', DENO_CLASSIC_SUNSET_HTTP_DATE)
  headers.set('Warning', `299 ubq.fi-router "${DENO_CLASSIC_FALLBACK_WARNING}"`)
  headers.append('Link', `<${DENO_CLASSIC_MIGRATION_URL}>; rel="deprecation"; type="text/html"`)
  headers.set('X-UOS-Deno-Classic-Fallback', 'true')
  headers.set('X-UOS-Deno-Classic-Sunset', DENO_CLASSIC_SUNSET_DATE)
  headers.set('X-UOS-Deno-Classic-Reason', denoTarget.fallbackReason ?? 'unknown')
  headers.set('X-UOS-Deno2-Target', denoTarget.deno2Url)
  headers.set('X-UOS-Deno-Classic-Target', denoTarget.classicUrl)
}

function buildPreviewUrl(subKey: string, url: URL): string {
  const base = subKey.replace(/^preview-/, '')
  const project = buildPreviewProject(base)
  return `https://${project}.deno.dev${url.pathname}${url.search}`
}

function buildPreviewProject(base: string): string {
  // Keep total length <= 26: p- + base + -ubq-fi (2 + len + 7)
  let name = base
  if (name.length > 17) {
    const hash = shortHash(name)
    name = `${name.slice(0, 12)}-${hash}`
  }
  return `p-${name}-ubq-fi`
}

function shortHash(input: string): string {
  // Lightweight deterministic hash, 4 hex chars
  let h = 0
  for (const ch of input) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0
  }
  return h.toString(16).padStart(4, '0').slice(0, 4)
}
