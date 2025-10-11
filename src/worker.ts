/**
 * UBQ.FI Router — Cloudflare Worker
 * Purpose: Deterministically route ubq.fi traffic to Deno Deploy apps.
 * Notes:
 *  - No KV, no LKG, no sticky cookies, no Pages fallback.
 *  - /rpc/:chainId is exposed same-origin to avoid CORS complexity, proxied to https://rpc.ubq.fi.
 */

import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import { buildDenoUrl } from './utils/build-deno-url'
import { buildPluginUrl } from './utils/build-plugin-url'

export interface Env {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Healthcheck
    if (url.pathname === '/__health') {
      return json({ status: 'ok', time: new Date().toISOString() })
    }

    // Same-origin RPC proxy (CORS-friendly)
    if (url.pathname.startsWith('/rpc/')) {
      return handleRpc(request, url)
    }

    // Compute Deno target URL and proxy
    const isPlugin = isPluginDomain(url.hostname)
    const target = isPlugin
      ? await buildPluginUrl(url.hostname, url, undefined as any, '')
      : buildDenoUrl(getSubdomainKey(url.hostname), url)

    return proxy(request, target)
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

async function handleRpc(request: Request, url: URL): Promise<Response> {
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
  const resp = await fetch(new Request(targetUrl, init))
  const outHeaders = new Headers(resp.headers)
  outHeaders.set('Access-Control-Allow-Origin', '*')
  outHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  outHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
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
  // Reverted version injection: return upstream response as-is
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })

  // Pass through non-HTML as-is
  const ct = res.headers.get('content-type') || ''
  const isHtml = ct.includes('text/html')
  if (!isHtml) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
  }

  // Derive a version fingerprint without upstream changes
  let version = ''
  // Prefer upstream header if present
  const upstreamHeader = res.headers.get('x-ubq-version')
  if (upstreamHeader) {
    version = upstreamHeader.trim()
  } else {
    // Try ETag
    const etag = res.headers.get('etag')
    if (etag) {
      version = shortenHash(stripQuotes(etag))
    } else {
      // Fallback: hash HTML body (using a clone to keep stream for HTMLRewriter)
      try {
        const clone = res.clone()
        const html = await clone.text()
        const hash = await sha256Hex(html)
        version = shortenHash(hash)
      } catch {
        version = ''
      }
    }
  }

  // Only inject visible footer badge for primary site; always add header
  const outHeaders = new Headers(res.headers)
  if (version) outHeaders.set('X-Ubq-Version', version)
  outHeaders.delete('content-length')

  if (hostname === 'ubq.fi' && version) {
    const rewriter = new HTMLRewriter().on('footer', {
      element(el) {
        el.append(`<div style="opacity:.7;font:12px/1.2 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;display:flex;gap:.5rem;align-items:center;margin-top:.5rem"><span>v${version}</span></div>`, { html: true })
      }
    })
    return rewriter.transform(new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders }))
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders })
}

function stripQuotes(s: string): string {
  return s.replace(/^W\//, '').replace(/^"|"$/g, '')
}

function shortenHash(h: string): string {
  const hex = h.replace(/[^0-9a-f]/gi, '')
  return hex.slice(0, 7)
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  const arr = Array.from(new Uint8Array(digest))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('')
}
