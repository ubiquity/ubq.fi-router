import { afterEach, describe, expect, test } from 'bun:test'
import worker, { proxyTimeoutMsForSubdomain, type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('worker Deno service routing', () => {
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

  test('injects revision footer into app html responses', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response('<html><body><main>Pay</main></body></html>', {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          etag: 'W/"abcdef1234567890"',
        },
      })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)
    const html = await res.text()

    expect(html).toContain('id="git-revision"')
    expect(html).toContain('abcdef123456')
    expect(html).toContain('href="https://github.com/ubiquity/pay.ubq.fi"')
    expect(html).toContain('https://pay-ubq-fi.ubiquity-dao.deno.net/')
    expect(res.headers.get('content-length')).toBe(null)
  })

  test('populates existing work-style revision anchor without duplicating it', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response('<html><body><div id="bottom-right"><a href="#" id="git-revision" target="_blank"></a></div></body></html>', {
        headers: {
          'content-type': 'text/html',
          'x-uos-app-revision': 'fedcba987654321',
        },
      })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://work.ubq.fi/'), {} as Env)
    const html = await res.text()

    expect(html.match(/id="git-revision"/g)?.length).toBe(1)
    expect(html).toContain('fedcba987654')
    expect(html).toContain('href="https://github.com/ubiquity/work.ubq.fi"')
  })

  test('does not inject revision footer into non-html responses', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/api'), {} as Env)
    const body = await res.text()

    expect(body).toBe(JSON.stringify({ ok: true }))
    expect(body).not.toContain('git-revision')
  })
})
