import { afterEach, describe, expect, test } from 'bun:test'
import worker, { proxyTimeoutMsForSubdomain, type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('worker Deno service routing', () => {
  test('serves a user-facing health dashboard on health.ubq.fi', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://health.ubq.fi/'), {} as Env)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(body).toContain('UBQ.FI Health Dashboard')
    expect(body).toContain('Router health endpoint')
    expect(body).toContain('Command plugin route')
    expect(body).toContain('/health.json')
  })

  test('serves health check JSON with degraded status when a check fails', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      if (req.url === 'https://ubq.fi/__health') {
        return new Response('ok', { status: 200 })
      }
      if (req.url === 'https://pay.ubq.fi/') {
        return new Response('upstream down', { status: 503 })
      }
      return new Response(null, { status: req.method === 'OPTIONS' ? 204 : 204 })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://health.ubq.fi/health.json'), {} as Env)
    const body = await res.json() as {
      status: string
      checks: Array<{ name: string; ok: boolean; status: number | null }>
    }

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(body.status).toBe('degraded')
    expect(body.checks.find((check) => check.name === 'Router health endpoint')?.ok).toBe(true)
    expect(body.checks.find((check) => check.name === 'Pay service route')?.ok).toBe(false)
  })

  test('gives ai service routes enough time for long model requests', () => {
    expect(proxyTimeoutMsForSubdomain('ai')).toBe(120_000)
    expect(proxyTimeoutMsForSubdomain('preview-ai')).toBe(120_000)
    expect(proxyTimeoutMsForSubdomain('pay')).toBe(30_000)
  })

  test('routes service traffic directly to Deno 2', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)
      return new Response('ok', { headers: { 'x-target-host': new URL(req.url).host } })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://ai.ubq.fi/v1/models?limit=1'), {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('x-target-host')).toBe('ai-ubq-fi.ubiquity-dao.deno.net')
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe(null)
    expect(targets).toEqual(['https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models?limit=1'])
  })

  test('passes Deno 2 missing-deployment responses through without Classic fallback', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)
      return new Response('missing', {
        status: 404,
        headers: { 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' },
      })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://missing.ubq.fi/'), {} as Env)

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('missing')
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe(null)
    expect(targets).toEqual(['https://missing-ubq-fi.ubiquity-dao.deno.net/'])
  })

  test('keeps preview branch routes on their generated preview project', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)
      return new Response('preview ok', { headers: { 'x-target-host': new URL(req.url).host } })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://preview-pay.ubq.fi/path?x=1'), {} as Env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('preview ok')
    expect(res.headers.get('x-target-host')).toBe('p-pay-ubq-fi.deno.dev')
    expect(targets).toEqual(['https://p-pay-ubq-fi.deno.dev/path?x=1'])
  })
})
