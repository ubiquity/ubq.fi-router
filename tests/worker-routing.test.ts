import { afterEach, describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('worker Deno service routing', () => {
  test('routes service traffic to Deno 2 when the app exists', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)
      if (req.method === 'HEAD') return new Response(null, { status: 404 })
      return new Response('ok', { headers: { 'x-target-host': new URL(req.url).host } })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://ai.ubq.fi/v1/models?limit=1'), {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-target-host')).toBe('ai-ubq-fi.ubiquity-dao.deno.net')
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe(null)
    expect(targets).toEqual([
      'https://ai-ubq-fi.ubiquity-dao.deno.net/__ubq_route_probe__',
      'https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models?limit=1',
    ])
  })

  test('falls back to Deploy Classic with sunset headers when Deno 2 is missing', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      if (req.method === 'HEAD') {
        return new Response(null, {
          status: 404,
          headers: { 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' },
        })
      }
      return new Response('classic ok', { headers: { 'x-target-host': new URL(req.url).host } })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://fixture.ubq.fi/__route_fixture__/resource'), {} as Env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('classic ok')
    expect(res.headers.get('x-target-host')).toBe('fixture-ubq-fi.deno.dev')
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe('true')
    expect(res.headers.get('x-uos-deno-classic-sunset')).toBe('2026-07-20')
    expect(res.headers.get('sunset')).toBe('Mon, 20 Jul 2026 00:00:00 GMT')
  })

  test('returns explanatory 503 when both Deno 2 and Deploy Classic are missing', async () => {
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 404,
        headers: { 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' },
      })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://missing.ubq.fi/'), {} as Env)
    const body = await res.json() as { error?: { code?: string; classic_sunset_date?: string } }

    expect(res.status).toBe(503)
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe('true')
    expect(body.error?.code).toBe('deno_classic_fallback_unavailable')
    expect(body.error?.classic_sunset_date).toBe('2026-07-20')
  })

  test('retries Deno 2 request when probe fails and Deploy Classic is missing', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)

      if (req.method === 'HEAD') {
        throw new Error('probe timeout')
      }
      if (req.url === 'https://ai-ubq-fi.deno.dev/v1/models') {
        return new Response(null, {
          status: 404,
          headers: { 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' },
        })
      }
      return new Response('deno2 ok', { headers: { 'x-target-host': new URL(req.url).host } })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://ai.ubq.fi/v1/models'), {} as Env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('deno2 ok')
    expect(res.headers.get('x-target-host')).toBe('ai-ubq-fi.ubiquity-dao.deno.net')
    expect(targets).toEqual([
      'https://ai-ubq-fi.ubiquity-dao.deno.net/__ubq_route_probe__',
      'https://ai-ubq-fi.deno.dev/v1/models',
      'https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models',
    ])
  })

  test('falls back to Deploy Classic when cached-positive Deno 2 request is missing', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)

      if (req.method === 'HEAD') {
        return new Response(null, { status: 404 })
      }
      if (req.url === 'https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models') {
        return new Response(null, {
          status: 404,
          headers: { 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' },
        })
      }
      return new Response('classic ok', { headers: { 'x-target-host': new URL(req.url).host } })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://ai.ubq.fi/v1/models'), {} as Env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('classic ok')
    expect(res.headers.get('x-target-host')).toBe('ai-ubq-fi.deno.dev')
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe('true')
    expect(res.headers.get('x-uos-deno-classic-reason')).toBe('deno2_deployment_not_found')
    expect(targets).toEqual([
      'https://ai-ubq-fi.ubiquity-dao.deno.net/__ubq_route_probe__',
      'https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models',
      'https://ai-ubq-fi.deno.dev/v1/models',
    ])
  })
})
