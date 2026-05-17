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
const HEALTH_DASHBOARD_HOST = 'health.ubq.fi'
const HEALTH_CHECK_TIMEOUT_MS = 5_000

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs (deno/plugin)
  LOG_RPC_SAMPLE?: string   // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
}

type LogKind = 'route' | 'rpc' | 'health'

type HealthCheckConfig = Readonly<{
  name: string
  type: 'router' | 'service' | 'plugin' | 'rpc'
  url: string
  method?: 'GET' | 'HEAD' | 'OPTIONS'
  okStatuses?: readonly number[]
}>

type HealthCheckResult = Readonly<{
  name: string
  type: HealthCheckConfig['type']
  url: string
  method: string
  ok: boolean
  status: number | null
  ms: number
  error?: string
}>

const HEALTH_CHECKS: readonly HealthCheckConfig[] = [
  {
    name: 'Router health endpoint',
    type: 'router',
    url: 'https://ubq.fi/__health',
    okStatuses: [200],
  },
  {
    name: 'Root service route',
    type: 'service',
    url: 'https://ubq.fi/',
    method: 'HEAD',
  },
  {
    name: 'Pay service route',
    type: 'service',
    url: 'https://pay.ubq.fi/',
    method: 'HEAD',
  },
  {
    name: 'Work service route',
    type: 'service',
    url: 'https://work.ubq.fi/',
    method: 'HEAD',
  },
  {
    name: 'AI service route',
    type: 'service',
    url: 'https://ai.ubq.fi/',
    method: 'HEAD',
  },
  {
    name: 'Command plugin route',
    type: 'plugin',
    url: 'https://os-command-config.ubq.fi/manifest.json',
    method: 'HEAD',
  },
  {
    name: 'RPC same-origin preflight',
    type: 'rpc',
    url: 'https://ubq.fi/rpc/1',
    method: 'OPTIONS',
    okStatuses: [204],
  },
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

    if (url.hostname === HEALTH_DASHBOARD_HOST) {
      return handleHealthDashboard(request, url)
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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withRouterRevision(new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    }))
  }

  if (url.pathname !== '/' && url.pathname !== '/health.json') {
    return withRouterRevision(new Response('Not Found', { status: 404 }))
  }

  const checks = await runHealthChecks()
  const payload = {
    status: checks.every((check) => check.ok) ? 'ok' : 'degraded',
    generated: new Date().toISOString(),
    revision: ROUTER_REVISION,
    checks,
  }

  if (url.pathname === '/health.json') {
    return withRouterRevision(json(payload))
  }

  const body = renderHealthDashboard(payload)
  return withRouterRevision(new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  }))
}

async function runHealthChecks(): Promise<HealthCheckResult[]> {
  return Promise.all(HEALTH_CHECKS.map(runHealthCheck))
}

async function runHealthCheck(check: HealthCheckConfig): Promise<HealthCheckResult> {
  const started = Date.now()
  const method = check.method || 'GET'
  try {
    const response = await fetch(check.url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    })
    return {
      name: check.name,
      type: check.type,
      url: check.url,
      method,
      ok: isHealthyStatus(response.status, check.okStatuses),
      status: response.status,
      ms: Date.now() - started,
    }
  } catch (err) {
    return {
      name: check.name,
      type: check.type,
      url: check.url,
      method,
      ok: false,
      status: null,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function isHealthyStatus(status: number, okStatuses?: readonly number[]): boolean {
  if (okStatuses) return okStatuses.includes(status)
  return status >= 200 && status < 500
}

function renderHealthDashboard(payload: {
  status: string
  generated: string
  revision: string
  checks: readonly HealthCheckResult[]
}): string {
  const rows = payload.checks.map((check) => {
    const statusText = check.status === null ? 'error' : String(check.status)
    const note = check.error ? `<span class="error">${escapeHtml(check.error)}</span>` : ''
    return `<tr>
      <td><span class="pill ${check.ok ? 'ok' : 'bad'}">${check.ok ? 'ok' : 'down'}</span></td>
      <td>${escapeHtml(check.name)}</td>
      <td>${escapeHtml(check.type)}</td>
      <td><code>${escapeHtml(check.method)}</code></td>
      <td><a href="${escapeHtml(check.url)}">${escapeHtml(check.url)}</a>${note}</td>
      <td>${escapeHtml(statusText)}</td>
      <td>${check.ms}ms</td>
    </tr>`
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>UBQ.FI Health Dashboard</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f8fb; color: #172033; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.15; }
    .summary { margin: 0 0 24px; color: #5b667a; }
    .panel { overflow-x: auto; background: #fff; border: 1px solid #dde3ee; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 840px; }
    th, td { padding: 12px 14px; border-bottom: 1px solid #edf1f7; text-align: left; vertical-align: top; }
    th { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: #68758b; background: #f9fbfe; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    a { color: #2455d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .pill { display: inline-block; min-width: 42px; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; text-align: center; }
    .ok { color: #075e39; background: #dff8eb; }
    .bad { color: #8a1d1d; background: #fde2e2; }
    .error { display: block; margin-top: 4px; color: #8a1d1d; font-size: 12px; }
    @media (prefers-color-scheme: dark) {
      body { background: #10141d; color: #edf2fb; }
      .summary { color: #a8b1c2; }
      .panel { background: #171d29; border-color: #2d3648; }
      th, td { border-color: #293244; }
      th { color: #b5bed0; background: #141a25; }
      a { color: #8fb0ff; }
      .ok { color: #bdf4d4; background: #143c2b; }
      .bad { color: #ffc4c4; background: #4a1f22; }
      .error { color: #ffc4c4; }
    }
  </style>
</head>
<body>
  <main>
    <h1>UBQ.FI Health Dashboard</h1>
    <p class="summary">Status: <strong>${escapeHtml(payload.status)}</strong> · Generated ${escapeHtml(payload.generated)} · Revision ${escapeHtml(payload.revision)} · <a href="/health.json">JSON</a></p>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Check</th>
            <th>Type</th>
            <th>Method</th>
            <th>Target</th>
            <th>HTTP</th>
            <th>Latency</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
