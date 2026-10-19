/**
 * UBQ.FI Router — Cloudflare Worker
 *
 * Routes ubq.fi hosts to their VPS origins through the DNS-only origin.ubq.fi
 * ingress (the VPS selects the app from x-forwarded-host). Deno Deploy is
 * retired: hosts without a VPS origin answer 410, and /rpc/:chainId stays a
 * same-origin proxy to https://rpc.ubq.fi.
 *
 * No KV, no sticky cookies, no Deno targets.
 */

declare const __UOS_ROUTER_REVISION__: string | undefined

const ROUTER_REVISION_HEADER = 'x-uos-router-revision'
const ROUTER_REVISION =
  typeof __UOS_ROUTER_REVISION__ === 'string' && __UOS_ROUTER_REVISION__.length > 0
    ? __UOS_ROUTER_REVISION__
    : 'local'
const DEFAULT_PROXY_TIMEOUT_MS = 30_000
// Model routes on the VPS gateway can stream for a long time.
const AI_PROXY_TIMEOUT_MS = 900_000
const DEFAULT_DEGRADED_TTL_MS = 10_000
const RETRYABLE_ORIGIN_STATUSES = new Set([502, 503, 504])
const ORIGIN_HEADER = 'x-uos-router-origin'

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs
  LOG_RPC_SAMPLE?: string // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
  /**
   * JSON object mapping a public host (for example "auth.ubq.fi") to the VPS
   * origin host that reaches the same app (a DNS-only hostname pointing at the
   * VPS). Other hosts answer 410 service_retired; auth.ubq.fi redirects to Passport.
   */
  VPS_ORIGIN_MAP?: string
  /** Seconds a failed origin stays marked degraded before it is retried. */
  VPS_DEGRADED_TTL_SECONDS?: string
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

    if (url.hostname === 'auth.ubq.fi') {
      return withRouterRevision(Response.redirect(`https://passport.ubq.fi${url.pathname}${url.search}`, 308))
    }

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
      return withRouterRevision(json({ status: 'ok', time: new Date().toISOString() }))
    }

    if (url.pathname.startsWith('/rpc/')) {
      return handleRpc(request, url, env)
    }

    const inHost = url.hostname
    const vpsOriginHost = parseVpsOriginMap(env.VPS_ORIGIN_MAP)[inHost]
    if (!vpsOriginHost) {
      // Deno Deploy is retired and this host has no VPS origin: nothing serves it.
      return withRouterRevision(json({ error: 'service_retired', host: inHost }, 410))
    }

    const target = `https://${vpsOriginHost}${url.pathname}${url.search}`
    const degradedKey = `${inHost}::${vpsOriginHost}`
    const degradedTtlMs = parseDegradedTtlMs(env.VPS_DEGRADED_TTL_SECONDS)
    const subKey = inHost.split('.')[0]
    const started = Date.now()

    if (originIsDegraded(degradedKey)) {
      return withRouterRevision(json({ error: 'origin_degraded', host: inHost }, 502))
    }

    try {
      const response = await proxy(request, target, proxyTimeoutMsForSubdomain(subKey))
      if (RETRYABLE_ORIGIN_STATUSES.has(response.status)) {
        markOriginDegraded(degradedKey, degradedTtlMs)
      } else {
        clearOriginDegraded(degradedKey)
      }
      const headers = new Headers(response.headers)
      headers.set(ORIGIN_HEADER, 'vps')
      if (shouldLog('route', request, url, env)) {
        try {
          console.log(JSON.stringify({
            event: 'route',
            t: new Date().toISOString(),
            method: request.method,
            inHost,
            hostHeader: request.headers.get('host') || undefined,
            path: url.pathname,
            hasQuery: url.search.length > 0,
            target,
            targetHost: new URL(target).hostname,
            origin: 'vps',
            status: response.status,
            ms: Date.now() - started,
            cfRay: request.headers.get('cf-ray') || undefined,
          }))
        } catch {}
      }
      return withRouterRevision(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }))
    } catch (err) {
      markOriginDegraded(degradedKey, degradedTtlMs)
      console.error(JSON.stringify({
        event: 'route_error',
        t: new Date().toISOString(),
        method: request.method,
        inHost,
        hostHeader: request.headers.get('host') || undefined,
        path: url.pathname,
        target,
        message: err instanceof Error ? err.message : String(err),
      }))
      return withRouterRevision(new Response('Upstream error', { status: 502 }))
    }
  },
}

function withRouterRevision(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set(ROUTER_REVISION_HEADER, ROUTER_REVISION)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function handleRpc(request: Request, url: URL, env: Env): Promise<Response> {
  const parts = url.pathname.split('/')
  const chainId = parts[2]
  if (!chainId || !/^\d+$/.test(chainId)) {
    return withRouterRevision(new Response('Invalid chain ID. Must be numeric.', { status: 400 }))
  }

  if (request.method === 'OPTIONS') {
    return withRouterRevision(new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
      },
    }))
  }

  const targetUrl = `https://rpc.ubq.fi/${chainId}${url.search}`
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    if (k === 'host' || k === 'origin' || k === 'referer') continue
    headers.set(key, value)
  }
  const started = Date.now()
  const resp = await fetch(new Request(targetUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  }))
  const outHeaders = new Headers(resp.headers)
  outHeaders.set('Access-Control-Allow-Origin', '*')
  outHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  outHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  if (shouldLog('rpc', request, url, env)) {
    try {
      console.log(JSON.stringify({
        event: 'route',
        t: new Date().toISOString(),
        route: 'rpc',
        method: request.method,
        inHost: url.hostname,
        path: url.pathname,
        target: targetUrl,
        status: resp.status,
        ms: Date.now() - started,
        cfRay: request.headers.get('cf-ray') || undefined,
      }))
    } catch {}
  }
  return withRouterRevision(new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders,
  }))
}

export function proxyTimeoutMsForSubdomain(subKey: string): number {
  return subKey === 'ai' ? AI_PROXY_TIMEOUT_MS : DEFAULT_PROXY_TIMEOUT_MS
}

async function proxy(request: Request, targetUrl: string, timeoutMs: number): Promise<Response> {
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase()
    // Strip only the hop headers; Origin and Cookie must reach the app
    // (session and hub origin-guard flows depend on them).
    if (k === 'host' || k === 'referer' || k === 'cf-ray') continue
    headers.set(key, value)
  }
  headers.set('x-forwarded-host', new URL(request.url).host)
  headers.set('x-forwarded-proto', 'https')

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.clone().body
  }
  const res = await fetch(new Request(targetUrl, init), { signal: AbortSignal.timeout(timeoutMs) })
  return res
}

/** Parse the VPS origin map totally: malformed input yields an empty map. */
export function parseVpsOriginMap(raw: string | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  if (!raw) return map
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return map
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return map
  for (const [host, origin] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof origin !== 'string') continue
    const normalizedHost = host.trim().toLowerCase()
    const normalizedOrigin = origin.trim().toLowerCase()
    if (!normalizedHost || !normalizedOrigin) continue
    if (!/^[a-z0-9.-]+$/.test(normalizedOrigin)) continue
    map[normalizedHost] = normalizedOrigin
  }
  return map
}

export function parseDegradedTtlMs(raw: string | undefined): number {
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_DEGRADED_TTL_MS
  return Math.min(seconds * 1000, 300_000)
}

// Isolate-local degraded markers: cheap, no bindings, and the isolate stops
// hammering a failed origin for the TTL.
const degradedOrigins = new Map<string, number>()

export function markOriginDegraded(key: string, ttlMs: number): void {
  degradedOrigins.set(key, Date.now() + ttlMs)
}

export function originIsDegraded(key: string): boolean {
  const until = degradedOrigins.get(key)
  if (until === undefined) return false
  if (until <= Date.now()) {
    degradedOrigins.delete(key)
    return false
  }
  return true
}

export function clearOriginDegraded(key: string): void {
  degradedOrigins.delete(key)
}

export function resetOriginHealth(): void {
  degradedOrigins.clear()
}
