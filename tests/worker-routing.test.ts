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
    }) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://ai.ubq.fi/v1/models?limit=1'), {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('x-target-host')).toBe('ai-ubq-fi.ubiquity-dao.deno.net')
    expect(res.headers.get('x-uos-deno-classic-fallback')).toBe(null)
    expect(targets).toEqual(['https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models?limit=1'])
  })

  test('injects the router revision link into HTML footers', async () => {
    const html = '<!doctype html><html><body><main>App</main><footer><span>UBQ</span></footer></body></html>'
    globalThis.fetch = (async () => {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(html.length),
        },
      })
    }) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('content-length')).toBe(null)
    expect(body).toContain('<footer><span>UBQ</span><a id="git-revision"')
    expect(body).toContain('href="https://github.com/ubiquity/ubq.fi-router"')
    expect(body).toContain('Revision local</a></footer>')
  })

  test('populates an existing git revision footer link', async () => {
    globalThis.fetch = (async () => {
      return new Response('<footer><a id="git-revision" href="#">old</a></footer>', {
        headers: { 'content-type': 'text/html' },
      })
    }) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)
    const body = await res.text()

    expect(body).toContain('<a id="git-revision" href="https://github.com/ubiquity/ubq.fi-router" rel="noopener noreferrer" target="_blank">Revision local</a>')
  })

  test('adds a revision footer to HTML responses without an existing footer', async () => {
    const html = '<!doctype html><html><body><main>App without footer</main></body></html>'
    globalThis.fetch = (async () => {
      return new Response(html, {
        headers: {
          'content-type': 'text/html',
          'content-length': String(html.length),
        },
      })
    }) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/no-footer'), {} as Env)
    const body = await res.text()

    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('content-length')).toBe(null)
    expect(body).toContain('<main>App without footer</main>')
    expect(body).toContain('<footer data-uos-router-revision="true"><a id="git-revision"')
    expect(body).toContain('Revision local</a></footer></body>')
  })

  test('passes non-HTML responses through without body rewrite', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json',
          'content-length': '11',
        },
      })
    }) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/api/state'), {} as Env)

    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('content-length')).toBe('11')
    expect(await res.text()).toBe('{"ok":true}')
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
    }) as unknown as typeof fetch

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
    }) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://preview-pay.ubq.fi/path?x=1'), {} as Env)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('preview ok')
    expect(res.headers.get('x-target-host')).toBe('p-pay-ubq-fi.deno.dev')
    expect(targets).toEqual(['https://p-pay-ubq-fi.deno.dev/path?x=1'])
  })

  // Regression: CodeRabbit review — body-less HTML responses must not be rewritten
  describe('withFooterRevision skips body-less HTML responses', () => {
    test('204 No Content with text/html content-type is not rewritten', async () => {
      globalThis.fetch = (async () => {
        return new Response(null, {
          status: 204,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        })
      }) as unknown as typeof fetch

      const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)

      expect(res.status).toBe(204)
      expect(res.headers.get('x-uos-router-revision')).toBe('local')
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
      const body = await res.text()
      expect(body).toBe('')
    })

    test('304 Not Modified with text/html content-type preserves headers and empty body', async () => {
      globalThis.fetch = (async () => {
        return new Response(null, {
          status: 304,
          headers: {
            'content-type': 'text/html',
            'etag': '"abc123"',
          },
        })
      }) as unknown as typeof fetch

      const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)

      expect(res.status).toBe(304)
      expect(res.headers.get('x-uos-router-revision')).toBe('local')
      expect(res.headers.get('etag')).toBe('"abc123"')
      expect(res.headers.get('content-type')).toBe('text/html')
      const body = await res.text()
      expect(body).toBe('')
    })

    test('200 HEAD with text/html and null body is not rewritten', async () => {
      // Simulates a HEAD response where upstream returns text/html but body is null
      globalThis.fetch = (async () => {
        return new Response(null, {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-length': '1234',
          },
        })
      }) as unknown as typeof fetch

      const res = await worker.fetch(new Request('https://pay.ubq.fi/', { method: 'HEAD' }), {} as Env)

      expect(res.status).toBe(200)
      expect(res.headers.get('x-uos-router-revision')).toBe('local')
      expect(res.headers.get('content-length')).toBe('1234')
      expect(res.headers.get('content-type')).toBe('text/html')
      const body = await res.text()
      expect(body).toBe('')
      // Verify no footer was injected
      expect(body).not.toContain('git-revision')
      expect(body).not.toContain('<footer')
    })

    test('200 text/html with actual body still gets footer injected', async () => {
      // Verify that the fix does not break normal HTML body rewriting
      const html = '<!doctype html><html><body><p>Hello</p></body></html>'
      globalThis.fetch = (async () => {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }) as unknown as typeof fetch

      const res = await worker.fetch(new Request('https://pay.ubq.fi/'), {} as Env)
      const body = await res.text()

      expect(res.status).toBe(200)
      expect(res.headers.get('x-uos-router-revision')).toBe('local')
      expect(body).toContain('git-revision')
      expect(body).toContain('<footer')
    })
  })
})
