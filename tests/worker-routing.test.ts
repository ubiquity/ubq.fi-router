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


describe('revision footer injection', () => {
  test('appends the router revision footer to proxied HTML responses', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('<html><body><main>ok</main></body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '41' },
    })) as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)
    const html = await res.text()

    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('content-length')).toBe(null)
    expect(html).toContain('<main>ok</main>')
    expect(html).toContain('class="uos-revision-footer"')
    expect(html).toContain('https://github.com/ubiquity/ubq.fi-router')
    expect(html).toContain('local</a>')
    expect(html).toContain('</body></html>')
  })

  test('does not append the revision footer to non-HTML responses', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/api'), {} as Env)
    const body = await res.text()

    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(body).toBe('{"ok":true}')
    expect(body).not.toContain('uos-revision-footer')
  })
})
