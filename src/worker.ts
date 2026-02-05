/**
 * UBQ.FI Router — Cloudflare Worker
 * Deterministic routing to Deno Deploy apps; /rpc is same‑origin proxy.
 * No KV, no discovery, no sticky cookies, no Pages fallback.
 * Includes automatic version footer injection for downstream apps.
 */

// These are injected at build time via wrangler.toml [vars] section
declare const GIT_REVISION: string;
declare const REPO_URL: string;

// Import routing utilities
import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import { buildDenoUrl } from './utils/build-deno-url'
import { buildPluginUrl } from './utils/build-plugin-url'

// Import version footer utilities
import { getAppVersion, initializeRegistry, preloadVersions } from './utils/app-registry'
import {
  shouldInjectFooter,
  injectFooter,
  getContentType,
  isBodyModified,
  markAsModified,
} from './utils/html-injector'

export interface Env {
  // Optional env vars to control logging without code changes
  LOG_ROUTE_SAMPLE?: string // 0..1 sampling for normal route logs (deno/plugin)
  LOG_RPC_SAMPLE?: string   // 0..1 sampling for RPC logs
  LOG_HEALTH_SAMPLE?: string // 0..1 sampling for health logs
  FOOTER_ENABLED?: string    // Enable/disable footer injection ('true' or 'false')
}

type LogKind = 'route' | 'rpc' | 'health' | 'footer'

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
    case 'footer':
      // Footer logs are verbose, log less frequently
      return Math.random() < 0.01
    default:
      return Math.random() < parseRate(env.LOG_ROUTE_SAMPLE, 0)
  }
}

function isFooterEnabled(env: Env): boolean {
  const footerEnabled = env.FOOTER_ENABLED?.toLowerCase()
  return footerEnabled !== 'false'
}

// Initialize app registry
initializeRegistry()

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    await ensureVersionCacheInitialized()

    // Health check endpoint
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
            version: GIT_REVISION,
          }))
        } catch {}
      }
      return json({
        status: 'ok',
        time: new Date().toISOString(),
        version: GIT_REVISION,
        repo: REPO_URL,
      })
    }

    // Version info endpoint
    if (url.pathname === '/__version') {
      const app = await getAppVersion(url.hostname)
      return json({
        version: GIT_REVISION,
        repo: REPO_URL,
        apps: app,
      })
    }

    // RPC endpoint
    if (url.pathname.startsWith('/rpc/')) {
      return handleRpc(request, url, env)
    }

    const inHost = url.hostname
    const isPlugin = isPluginDomain(inHost)
    const subKey = getSubdomainKey(inHost)
    const target = isPlugin
      ? buildPluginUrl(inHost, url)
      : subKey.startsWith('preview-')
        ? buildPreviewUrl(subKey, url)
        : buildDenoUrl(subKey, url)

    const started = Date.now()
    try {
      const res = await proxy(request, target, inHost, env)
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
            version: GIT_REVISION,
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
        message: err instanceof Error ? err.message : String(err),
        version: GIT_REVISION,
        repo: REPO_URL,
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

// Version cache management
let versionCacheInitialized = false;
let versionCachePromise: Promise<void> | null = null;

async function ensureVersionCacheInitialized(): Promise<void> {
  if (versionCacheInitialized) return;
  if (versionCachePromise) return versionCachePromise;

  versionCachePromise = (async () => {
    try {
      await preloadVersions();
    } catch (err) {
      console.error(JSON.stringify({
        event: 'version_cache_error',
        t: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      versionCacheInitialized = true;
      versionCachePromise = null;
    }
  })();

  return versionCachePromise;
}

async function proxy(
  request: Request,
  targetUrl: string,
  inHost: string,
  env: Env,
  timeoutMs = 6000
): Promise<Response> {
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
  
  const resp = await fetch(new Request(targetUrl, init), { signal: AbortSignal.timeout(timeoutMs) })

  // Try to inject version footer for HTML responses
  if (isFooterEnabled(env) && request.method === 'GET') {
    const contentType = getContentType(resp.headers)
    const shouldInject = shouldInjectFooter(contentType, resp.status, new URL(targetUrl).pathname)
    
    if (shouldInject && !isBodyModified(resp.headers)) {
      try {
        // Get version info for this app
        const versionInfo = await getAppVersion(inHost)
        
        if (versionInfo) {
          // Clone the response to read the body
          const clonedResponse = resp.clone()
          const body = await clonedResponse.text()
          
          // Check if footer already exists
          if (body.includes('id="version-footer"')) {
            if (shouldLog('footer', request, new URL(request.url), env)) {
              console.log(JSON.stringify({
                event: 'footer_skipped',
                t: new Date().toISOString(),
                inHost,
                targetHost: new URL(targetUrl).hostname,
                path: new URL(request.url).pathname,
                reason: 'already_exists',
              }))
            }
            return clonedResponse
          }
          
          // Inject footer
          const modifiedHtml = injectFooter(body, {
            commitHash: versionInfo.commitHash,
            repoUrl: versionInfo.repoUrl,
          })
          
          const outHeaders = new Headers(resp.headers)
          outHeaders.set('Content-Type', 'text/html; charset=utf-8')
          // Remove stale headers that are now invalid after body modification
          outHeaders.delete('content-encoding')
          outHeaders.delete('content-length')
          outHeaders.delete('etag')
          markAsModified(outHeaders)
          
          if (shouldLog('footer', request, new URL(request.url), env)) {
            console.log(JSON.stringify({
              event: 'footer_injected',
              t: new Date().toISOString(),
              inHost,
              targetHost: new URL(targetUrl).hostname,
              path: new URL(request.url).pathname,
              commitHash: versionInfo.commitHash.substring(0, 7),
              fromCache: versionInfo.fromCache,
            }))
          }
          
          return new Response(modifiedHtml, {
            status: resp.status,
            statusText: resp.statusText,
            headers: outHeaders,
          })
        }
      } catch (err) {
        // Footer injection failed, continue with original response
        console.error(JSON.stringify({
          event: 'footer_error',
          t: new Date().toISOString(),
          inHost,
          targetHost: new URL(targetUrl).hostname,
          message: err instanceof Error ? err.message : String(err),
        }))
      }
    }
  }

  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: resp.headers })
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
