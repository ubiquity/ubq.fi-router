/**
 * UBQ.FI Router — Cloudflare Worker
 * Deterministic routing to Deno Deploy apps; /rpc is same‑origin proxy.
 * Service routes use Deno Deploy 2 directly.
 * No KV, no sticky cookies, no Pages fallback.
 */

import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import {
  type DenoRouteTarget,
  resolveDenoUrl,
} from './utils/build-deno-url'
import { buildPluginUrl } from './utils/build-plugin-url'

declare const __UOS_ROUTER_REVISION__: string | undefined

const ROUTER_REVISION_HEADER = 'x-uos-router-revision'
const ROUTER_REVISION =
  typeof __UOS_ROUTER_REVISION__ === 'string' && __UOS_ROUTER_REVISION__.length > 0
    ? __UOS_ROUTER_REVISION__
    : 'local'
const DEFAULT_PROXY_TIMEOUT_MS = 30_000
const AI_PROXY_TIMEOUT_MS = 120_000

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs (deno/plugin)
  LOG_RPC_SAMPLE?: string   // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
  HEALTH_TARGETS?: string // JSON array of { name, url, kind? } entries for health.ubq.fi
}

type LogKind = 'route' | 'rpc' | 'health'
type HealthTarget = Readonly<{
  name: string
  url: string
  kind?: string
}>
type HealthResult = HealthTarget & Readonly<{
  ok: boolean
  status?: number
  ms: number
  error?: string
}>

const DEFAULT_HEALTH_TARGETS: HealthTarget[] = [
  { name: 'ubq.fi', kind: 'app', url: 'https://ubq.fi/__health' },
  { name: 'pay.ubq.fi', kind: 'app', url: 'https://pay.ubq.fi/__health' },
  { name: 'work.ubq.fi', kind: 'app', url: 'https://work.ubq.fi/__health' },
  { name: 'rpc.ubq.fi', kind: 'rpc', url: 'https://rpc.ubq.fi/1' },
]

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

    if (url.hostname === 'health.ubq.fi' || url.pathname === '/__health/dashboard') {
      return handleHealthDashboard(request, url, env)
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
      const result = await proxyRoute(request, target, denoTarget)
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
        message: err instanceof Error ? err.message : String(err)
      }))
      return withRouterRevision(new Response('Upstream error', { status: 502 }))
    }
  }
}

async function handleHealthDashboard(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withRouterRevision(new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    }))
  }

  const targets = getHealthTargets(env)
  const checkedAt = new Date().toISOString()
  const results = await Promise.all(targets.map(checkHealthTarget))
  const ok = results.every((result) => result.ok)
  const body = {
    status: ok ? 'ok' : 'degraded',
    checkedAt,
    revision: ROUTER_REVISION,
    targets: results,
  }

  if (url.pathname.endsWith('.json') || url.searchParams.get('format') === 'json') {
    return withRouterRevision(json(body, ok ? 200 : 503))
  }

  return withRouterRevision(new Response(request.method === 'HEAD' ? null : renderHealthDashboard(body), {
    status: ok ? 200 : 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }))
}

function getHealthTargets(env: Env): HealthTarget[] {
  if (!env.HEALTH_TARGETS) return DEFAULT_HEALTH_TARGETS
  try {
    const parsed = JSON.parse(env.HEALTH_TARGETS)
    if (!Array.isArray(parsed)) return DEFAULT_HEALTH_TARGETS
    const targets = parsed
      .filter((item): item is HealthTarget => {
        return item &&
          typeof item.name === 'string' &&
          typeof item.url === 'string' &&
          (!item.kind || typeof item.kind === 'string') &&
          /^https:\/\//.test(item.url)
      })
      .slice(0, 50)
    return targets.length > 0 ? targets : DEFAULT_HEALTH_TARGETS
  } catch {
    return DEFAULT_HEALTH_TARGETS
  }
}

async function checkHealthTarget(target: HealthTarget): Promise<HealthResult> {
  const started = Date.now()
  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    })
    return {
      ...target,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      ms: Date.now() - started,
    }
  } catch (error) {
    return {
      ...target,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function renderHealthDashboard(report: {
  status: string
  checkedAt: string
  revision: string
  targets: HealthResult[]
}): string {
  const rows = report.targets.map((target) => {
    const status = target.ok ? 'ok' : 'degraded'
    const statusText = target.status ? String(target.status) : target.error || 'error'
    return `<tr class="${status}"><td>${escapeHtml(target.name)}</td><td>${escapeHtml(target.kind || 'service')}</td><td>${escapeHtml(statusText)}</td><td>${target.ms}ms</td><td><a href="${escapeHtml(target.url)}">${escapeHtml(target.url)}</a></td></tr>`
  }).join('')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UBQ.FI Health</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f8fb;color:#121417}
    main{max-width:980px;margin:0 auto;padding:40px 20px}
    h1{font-size:40px;margin:0 0 8px}.meta{color:#5d6673;margin-bottom:24px}
    .badge{display:inline-block;border-radius:999px;padding:6px 12px;font-weight:700;background:${report.status === 'ok' ? '#d7f7e3' : '#ffe1e1'};color:${report.status === 'ok' ? '#116b34' : '#9a1d1d'}}
    table{width:100%;border-collapse:collapse;background:white;border:1px solid #dfe3ea;border-radius:8px;overflow:hidden}
    th,td{text-align:left;padding:12px;border-bottom:1px solid #edf0f4;font-size:14px}th{background:#f0f3f8;color:#384151}
    tr:last-child td{border-bottom:0}.ok td:first-child{border-left:4px solid #22a45a}.degraded td:first-child{border-left:4px solid #db3b3b}
    a{color:#225fc2;word-break:break-all}
  </style>
</head>
<body>
  <main>
    <h1>UBQ.FI Health</h1>
    <p class="meta"><span class="badge">${escapeHtml(report.status)}</span> Checked ${escapeHtml(report.checkedAt)} · revision ${escapeHtml(report.revision)}</p>
    <table>
      <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Latency</th><th>Target</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
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
        'Access-Control-Max-Age': '86400'
      }
    }))
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
  return withRouterRevision(new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders }))
}

export function proxyTimeoutMsForSubdomain(subKey: string): number {
  return subKey === 'ai' || subKey === 'preview-ai'
    ? AI_PROXY_TIMEOUT_MS
    : DEFAULT_PROXY_TIMEOUT_MS
}

async function proxy(request: Request, targetUrl: string, timeoutMs: number): Promise<Response> {
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
  return withRouterRevision(new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }))
}

type RouteProxyResult = Readonly<{
  response: Response
  target: string
  denoRouteKind?: DenoRouteTarget['kind']
}>

async function proxyRoute(
  request: Request,
  target: string,
  denoTarget: DenoRouteTarget | null,
): Promise<RouteProxyResult> {
  const subKey = getSubdomainKey(new URL(request.url).hostname)
  const res = await proxy(request, target, proxyTimeoutMsForSubdomain(subKey))
  return {
    response: res,
    target,
    denoRouteKind: denoTarget?.kind,
  }
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
