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
const APP_REVISION_ANCHOR_ID = 'git-revision'
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
  const url = new URL(request.url)
  const subKey = getSubdomainKey(url.hostname)
  const res = await proxy(request, target, proxyTimeoutMsForSubdomain(subKey))
  return {
    response: await appendRevisionFooter(res, request, target, subKey, isPluginDomain(url.hostname)),
    target,
    denoRouteKind: denoTarget?.kind,
  }
}

async function appendRevisionFooter(
  response: Response,
  request: Request,
  target: string,
  subKey: string,
  isPlugin: boolean,
): Promise<Response> {
  if (request.method === 'HEAD') return response
  if (!isHtmlResponse(response)) return response

  const html = await response.text()
  const revision = getAppRevision(response.headers, target)
  const repoUrl = getRepoUrl(subKey, isPlugin)
  const footer = buildRevisionFooter(revision, repoUrl, target)
  const nextHtml = html.match(new RegExp(`id=["']${APP_REVISION_ANCHOR_ID}["']`, 'i'))
    ? updateExistingRevisionAnchor(html, revision, repoUrl, target)
    : injectBeforeBodyEnd(html, footer)

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(nextHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/html')
}

function getAppRevision(headers: Headers, target: string): string {
  const explicitRevision =
    headers.get('x-uos-app-revision') ||
    headers.get('x-app-revision') ||
    headers.get('x-deno-deployment-id') ||
    headers.get('etag')

  if (explicitRevision) {
    return explicitRevision.replace(/^W\//, '').replace(/^"|"$/g, '').slice(0, 12)
  }

  return new URL(target).hostname
}

function getRepoUrl(subKey: string, isPlugin: boolean): string {
  const name = subKey.replace(/^preview-/, '')
  if (isPlugin) {
    return `https://github.com/ubiquity-os-marketplace/${name}`
  }
  return `https://github.com/ubiquity/${name || 'ubq'}.ubq.fi`
}

function buildRevisionFooter(revision: string, repoUrl: string, target: string): string {
  const safeRevision = escapeHtml(revision)
  const safeRepoUrl = escapeHtml(repoUrl)
  const safeTarget = escapeHtml(target)

  return `
<style id="uos-revision-footer-style">
  #bottom-right { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 8px; align-items: center; }
  #${APP_REVISION_ANCHOR_ID} { color: inherit; opacity: 0.68; font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-decoration: none; }
  #${APP_REVISION_ANCHOR_ID}:hover { opacity: 1; text-decoration: underline; }
</style>
<div id="bottom-right"><a href="${safeRepoUrl}" id="${APP_REVISION_ANCHOR_ID}" target="_blank" rel="noopener noreferrer" title="${safeTarget}">${safeRevision}</a></div>`
}

function updateExistingRevisionAnchor(html: string, revision: string, repoUrl: string, target: string): string {
  const safeRevision = escapeHtml(revision)
  const safeRepoUrl = escapeHtml(repoUrl)
  const safeTarget = escapeHtml(target)

  return html.replace(
    /<a\b([^>]*\bid=["']git-revision["'][^>]*)>[\s\S]*?<\/a>/i,
    (_match, attrs: string) => {
      const nextAttrs = upsertAttribute(upsertAttribute(upsertAttribute(attrs, 'href', safeRepoUrl), 'title', safeTarget), 'rel', 'noopener noreferrer')
      return `<a${nextAttrs}>${safeRevision}</a>`
    },
  )
}

function upsertAttribute(attrs: string, name: string, value: string): string {
  const pattern = new RegExp(`\\s${name}=(["']).*?\\1`, 'i')
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, ` ${name}="${value}"`)
  }
  return `${attrs} ${name}="${value}"`
}

function injectBeforeBodyEnd(html: string, fragment: string): string {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${fragment}</body>`)
  }
  return `${html}${fragment}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
