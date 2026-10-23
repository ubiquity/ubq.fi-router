import { afterEach, describe, expect, test } from 'bun:test'
import worker, { resetOriginHealth, type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  resetOriginHealth()
})

const mappedEnv = { VPS_ORIGIN_MAP: '{"passport.ubq.fi":"origin.ubq.fi","pay.ubq.fi":"origin.ubq.fi"}' } as Env

describe('HTML revision footer decoration (#37)', () => {
  test('strips Content-Digest, Repr-Digest, and legacy validators when rewriting HTML', async () => {
    const html = '<!doctype html><html><body><main>Pay</main></body></html>'
    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(html.length),
          'content-md5': 'dGVzdA==',
          digest: 'sha-256=legacy',
          'content-digest': 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:',
          'repr-digest': 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:',
          etag: '"abc123"',
        },
      })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), mappedEnv)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('id="git-revision"')
    expect(res.headers.get('content-length')).toBe(null)
    expect(res.headers.get('content-md5')).toBe(null)
    expect(res.headers.get('digest')).toBe(null)
    expect(res.headers.get('content-digest')).toBe(null)
    expect(res.headers.get('repr-digest')).toBe(null)
    expect(res.headers.get('etag')).toBe(null)
  })

  test('skips HTML decoration and preserves digest headers when response Cache-Control contains no-transform', async () => {
    const html = '<!doctype html><html><body><main>Immutable</main></body></html>'
    const digestValue = 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:'
    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=60, no-transform',
          'content-digest': digestValue,
          'repr-digest': digestValue,
        },
      })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://pay.ubq.fi/'), mappedEnv)
    const body = await res.text()

    expect(body).toBe(html)
    expect(res.headers.get('content-digest')).toBe(digestValue)
    expect(res.headers.get('repr-digest')).toBe(digestValue)
  })

  test('skips HTML decoration and preserves digest headers when request Cache-Control contains no-transform', async () => {
    const html = '<!doctype html><html><body><main>Client No-Transform</main></body></html>'
    const digestValue = 'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:'
    globalThis.fetch = (async () =>
      new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-digest': digestValue,
          'repr-digest': digestValue,
        },
      })) as unknown as typeof fetch

    const res = await worker.fetch(
      new Request('https://pay.ubq.fi/', {
        headers: { 'cache-control': 'no-cache, No-Transform' },
      }),
      mappedEnv
    )
    const body = await res.text()

    expect(body).toBe(html)
    expect(res.headers.get('content-digest')).toBe(digestValue)
    expect(res.headers.get('repr-digest')).toBe(digestValue)
  })
})
