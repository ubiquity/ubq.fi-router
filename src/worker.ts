/**
 * UBQ.FI Router — Cloudflare Worker
 * Deterministic routing to Deno Deploy apps; /rpc is same‑origin proxy.
 * Service routes use Deno Deploy 2 directly.
 * No KV, no sticky cookies, no Pages fallback.
 */

import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import {
  buildDeno2Url,
  buildDeno2AppSlug,
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

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs (deno/plugin)
  LOG_RPC_SAMPLE?: string   // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
}

type LogKind = 'route' | 'rpc' | 'health'

const HEALTH_DASHBOARD_SUBDOMAIN = 'health'
const HEALTH_CHECK_TIMEOUT_MS = 2500
const HEALTH_DASHBOARD_SERVICES = [
  { name: 'ubq.fi', subdomain: '', repo: 'ubiquity/ubq.fi' },
  { name: 'work.ubq.fi', subdomain: 'work', repo: 'ubiquity/work.ubq.fi' },
  { name: 'pay.ubq.fi', subdomain: 'pay', repo: 'ubiquity/pay.ubq.fi' },
  { name: 'ai.ubq.fi', subdomain: 'ai', repo: 'ubiquity/ai.ubq.fi' },
  { name: 'rpc.ubq.fi', subdomain: 'rpc', repo: 'ubiquity/rpc.ubq.fi' },
] as const

type HealthProbe = Readonly<{
  name: string
  repo: string
  url: string
  status: 'ok' | 'down'
  statusCode: number | null
  ms: number
}>

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
      return withRouterRevision(json({ status: 'ok', time: new Date().toISOString() }))
    }

    if (url.pathname.startsWith('/rpc/')) {
      return handleRpc(request, url, env)
    }

    const inHost = url.hostname
    const isPlugin = isPluginDomain(inHost)
    const subKey = getSubdomainKey(inHost)
    if (!isPlugin && subKey === HEALTH_DASHBOARD_SUBDOMAIN) {
      return handleHealthDashboard(request, url)
    }

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

async function handleHealthDashboard(request: Request, url: URL): Promise<Response> {
  const probes = await collectHealthProbes()
  const acceptsJson =
    url.pathname === '/status.json' ||
    request.headers.get('accept')?.includes('application/json')

  if (acceptsJson) {
    return withRouterRevision(json({
      status: probes.every((probe) => probe.status === 'ok') ? 'ok' : 'degraded',
      generated: new Date().toISOString(),
      services: probes,
    }))
  }

  if (url.pathname !== '/') {
    return withRouterRevision(new Response('Not found', { status: 404 }))
  }

  return withRouterRevision(new Response(renderHealthDashboard(probes), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }))
}

async function collectHealthProbes(): Promise<HealthProbe[]> {
  return Promise.all(HEALTH_DASHBOARD_SERVICES.map(async (service) => {
    const started = Date.now()
    const healthUrl = buildDeno2Url(service.subdomain, new URL('https://ubq.fi/__health'))
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      })
      return {
        name: service.name,
        repo: service.repo,
        url: healthUrl,
        status: response.ok ? 'ok' : 'down',
        statusCode: response.status,
        ms: Date.now() - started,
      }
    } catch {
      return {
        name: service.name,
        repo: service.repo,
        url: healthUrl,
        status: 'down',
        statusCode: null,
        ms: Date.now() - started,
      }
    }
  }))
}

function renderHealthDashboard(probes: readonly HealthProbe[]): string {
  const okCount = probes.filter((probe) => probe.status === 'ok').length
  const rows = probes.map((probe) => {
    const repoUrl = `https://github.com/${probe.repo}`
    return `<tr>
      <td><a href="https://${probe.name}">${escapeHtml(probe.name)}</a></td>
      <td><a href="${repoUrl}">${escapeHtml(probe.repo)}</a></td>
      <td><a href="${escapeHtml(probe.url)}">${escapeHtml(buildDeno2AppSlug(serviceSubdomainFromName(probe.name)))}</a></td>
      <td><span class="status ${probe.status}">${probe.status}</span></td>
      <td>${probe.statusCode ?? 'timeout'}</td>
      <td>${probe.ms}ms</td>
    </tr>`
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>UBQ.FI Health</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    main { max-width: 960px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p { margin: 0 0 24px; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; }
    th, td { padding: 12px 14px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    th { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }
    a { color: #2563eb; text-decoration: none; }
    .summary { display: inline-flex; gap: 8px; align-items: center; margin-bottom: 20px; padding: 8px 12px; border: 1px solid #e5e7eb; background: #fff; }
    .status { display: inline-block; min-width: 48px; padding: 3px 8px; border-radius: 999px; font-weight: 700; text-align: center; }
    .ok { color: #166534; background: #dcfce7; }
    .down { color: #991b1b; background: #fee2e2; }
  </style>
</head>
<body>
  <main>
    <h1>UBQ.FI Health</h1>
    <p>Live status checks for core apps routed through the UBQ.FI worker.</p>
    <div class="summary">${okCount}/${probes.length} services healthy</div>
    <table>
      <thead><tr><th>Service</th><th>Repository</th><th>Deno app</th><th>Status</th><th>HTTP</th><th>Latency</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`
}

function serviceSubdomainFromName(name: string): string {
  return name === 'ubq.fi' ? '' : name.replace(/\.ubq\.fi$/, '')
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
  const res = await proxy(request, target)
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
