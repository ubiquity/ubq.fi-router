/**
 * UBQ.FI Router — Cloudflare Worker
 * Deterministic routing to Deno Deploy apps; /rpc is same‑origin proxy.
 * No KV, no discovery, no sticky cookies, no Pages fallback.
 */

import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import { buildDenoUrl } from './utils/build-deno-url'
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
    const target = isPlugin
      ? buildPluginUrl(inHost, url)
      : buildDenoUrl(subKey, url)

    const started = Date.now()
    try {
      const res = await proxy(request, target)
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
            target,
            targetHost: new URL(target).hostname,
            status: res.status,
            ms: Date.now() - started,
            workIncoming: inHost === 'work.ubq.fi',
            workTarget: !isPlugin && subKey === 'work',
            cfRay: request.headers.get('cf-ray') || undefined,
          }
          // Structured JSON log for easy filtering in Workers Logs
          console.log(JSON.stringify({ event: 'route', ...log }))
        } catch {}
      }
      return res
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
