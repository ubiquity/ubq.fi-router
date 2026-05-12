import { afterEach, describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('worker Deno service routing', () => {
  test('renders health dashboard for health.ubq.fi', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://health.ubq.fi/'), {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('UBQ.FI Health')
    expect(targets).toContain('https://work-ubq-fi.ubiquity-dao.deno.net/__health')
    expect(targets).toContain('https://pay-ubq-fi.ubiquity-dao.deno.net/__health')
  })

  test('returns health status JSON for health.ubq.fi/status.json', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      const status = req.url.includes('pay-ubq-fi') ? 503 : 200
      return new Response(JSON.stringify({ status }), { status })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://health.ubq.fi/status.json'), {} as Env)
    const body = await res.json() as {
      status: string
      services: Array<{ name: string; status: string; statusCode: number }>
    }

    expect(res.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.services.find((service) => service.name === 'pay.ubq.fi')?.status).toBe('down')
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
