import { afterEach, describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('worker Deno service routing', () => {
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

describe('health dashboard routing', () => {
  test('serves health.ubq.fi from the router instead of proxying it as a service', async () => {
    const targets: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      targets.push(req.url)
      return new Response('ok')
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://health.ubq.fi/'), {
      HEALTH_SERVICE_HOSTS: 'pay.ubq.fi',
      HEALTH_PLUGIN_HOSTS: 'os-command-wallet.ubq.fi',
    } as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(await res.text()).toContain('UBQ.FI Health')
    expect(targets).toEqual([
      'https://pay-ubq-fi.ubiquity-dao.deno.net/',
      'https://command-wallet-main.deno.dev/',
    ])
  })

  test('exposes machine-readable health checks', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://health.ubq.fi/api/health'), {
      HEALTH_SERVICE_HOSTS: 'pay.ubq.fi',
      HEALTH_PLUGIN_HOSTS: 'os-command-wallet.ubq.fi',
      HEALTH_TIMEOUT_MS: '1000',
    } as Env)
    const body = await res.json() as {
      status: string
      checks: Array<{ kind: string; host: string; url: string; ok: boolean; status: number; ms: number }>
    }

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.checks).toEqual([
      {
        kind: 'service',
        host: 'pay.ubq.fi',
        url: 'https://pay-ubq-fi.ubiquity-dao.deno.net/',
        ok: true,
        status: 204,
        ms: expect.any(Number),
      },
      {
        kind: 'plugin',
        host: 'os-command-wallet.ubq.fi',
        url: 'https://command-wallet-main.deno.dev/',
        ok: true,
        status: 204,
        ms: expect.any(Number),
      },
    ])
  })
})
