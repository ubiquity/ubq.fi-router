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

  test('appends router revision footer to HTML responses', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('<!doctype html><html><body><main>ok</main></body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '55' },
    })) as typeof fetch

    const res = await worker.fetch(new Request('https://work.ubq.fi/'), {} as Env)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('content-length')).toBe(null)
    expect(body).toContain('id="bottom-right"')
    expect(body).toContain('id="git-revision"')
    expect(body).toContain('https://github.com/ubiquity/work.ubq.fi')
    expect(body).toContain('<main>ok</main><div id="bottom-right"')
  })

  test('populates existing git revision link instead of duplicating the footer', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('<!doctype html><html><body><div id="bottom-right"><a href="#" id="git-revision" target="_blank"></a></div></body></html>', {
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)
    const body = await res.text()

    expect(body.match(/id="bottom-right"/g)).toHaveLength(1)
    expect(body.match(/id="git-revision"/g)).toHaveLength(1)
    expect(body).toContain('href="https://github.com/ubiquity/pay.ubq.fi"')
    expect(body).toContain('>local</a>')
  })

  test('does not append router revision footer to non-HTML responses', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    const res = await worker.fetch(new Request('https://api.ubq.fi/status'), {} as Env)
    const body = await res.text()

    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(body).toBe('{"ok":true}')
    expect(body).not.toContain('git-revision')
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
