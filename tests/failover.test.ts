import { afterEach, describe, expect, test } from 'bun:test'
import worker, {
  parseDegradedTtlMs,
  parseVpsOriginMap,
  resetOriginHealth,
  type Env,
} from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  resetOriginHealth()
})

function mockFetch(handler: (req: Request) => Response | Promise<Response>): string[] {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    calls.push(req.url)
    return await handler(req)
  }) as typeof fetch
  return calls
}

const mappedEnv = { VPS_ORIGIN_MAP: '{"auth.ubq.fi":"origin.ubq.fi"}' } as Env

describe('parseVpsOriginMap', () => {
  test('parses a valid map and normalizes case', () => {
    expect(parseVpsOriginMap('{"Auth.Ubq.Fi":"Origin.Ubq.Fi"}')).toEqual({ 'auth.ubq.fi': 'origin.ubq.fi' })
  })

  test('malformed or hostile input yields an empty map', () => {
    expect(parseVpsOriginMap(undefined)).toEqual({})
    expect(parseVpsOriginMap('{oops')).toEqual({})
    expect(parseVpsOriginMap('["a"]')).toEqual({})
    expect(parseVpsOriginMap('{"a":42}')).toEqual({})
    expect(parseVpsOriginMap('{"a":"https://evil.example/"}')).toEqual({})
  })
})

describe('parseDegradedTtlMs', () => {
  test('defaults and clamps', () => {
    expect(parseDegradedTtlMs(undefined)).toBe(10_000)
    expect(parseDegradedTtlMs('0')).toBe(10_000)
    expect(parseDegradedTtlMs('5')).toBe(5_000)
    expect(parseDegradedTtlMs('100000')).toBe(300_000)
  })
})

describe('worker origin failover', () => {
  test('mapped host serves from the VPS first and reports the origin', async () => {
    const calls = mockFetch((req) => new Response(`vps:${new URL(req.url).host}`))

    const res = await worker.fetch(new Request('https://auth.ubq.fi/health'), mappedEnv)

    expect(await res.text()).toBe('vps:origin.ubq.fi')
    expect(calls).toEqual(['https://origin.ubq.fi/health'])
    expect(res.headers.get('x-uos-router-origin')).toBe('vps')
    expect(res.headers.get('x-uos-router-failover')).toBe(null)
  })

  test('fallback to Deno on a retryable VPS status and skips it while degraded', async () => {
    const calls = mockFetch((req) => {
      const host = new URL(req.url).host
      if (host === 'origin.ubq.fi') return new Response('down', { status: 503 })
      return new Response(`deno:${host}`)
    })

    const first = await worker.fetch(new Request('https://auth.ubq.fi/health'), mappedEnv)
    expect(await first.text()).toBe('deno:auth-ubq-fi.ubiquity-dao.deno.net')
    expect(first.headers.get('x-uos-router-origin')).toBe('deno')
    expect(first.headers.get('x-uos-router-failover')).toBe('1')

    const before = calls.length
    const second = await worker.fetch(new Request('https://auth.ubq.fi/health'), mappedEnv)
    expect(await second.text()).toBe('deno:auth-ubq-fi.ubiquity-dao.deno.net')
    expect(calls.length - before).toBe(1)
  })

  test('fallback to Deno when the VPS fetch throws', async () => {
    let attempt = 0
    const calls = mockFetch(() => {
      attempt += 1
      if (attempt === 1) throw new Error('connect timeout')
      return new Response('deno-ok')
    })

    const res = await worker.fetch(new Request('https://auth.ubq.fi/health'), mappedEnv)

    expect(await res.text()).toBe('deno-ok')
    expect(calls).toHaveLength(2)
    expect(res.headers.get('x-uos-router-failover')).toBe('1')
  })

  test('unmapped hosts keep the Deno-only path with a single fetch', async () => {
    const calls = mockFetch((req) => new Response(new URL(req.url).host))

    const res = await worker.fetch(new Request('https://pay.ubq.fi/checkout'), mappedEnv)

    expect(await res.text()).toBe('pay-ubq-fi.ubiquity-dao.deno.net')
    expect(calls).toEqual(['https://pay-ubq-fi.ubiquity-dao.deno.net/checkout'])
    expect(res.headers.get('x-uos-router-origin')).toBe('deno')
    expect(res.headers.get('x-uos-router-failover')).toBe(null)
  })

  test('forwards Origin and Cookie upstream and strips referer', async () => {
    const seen: { value: Headers | null } = { value: null }
    mockFetch((req) => {
      seen.value = req.headers
      return new Response('ok')
    })

    await worker.fetch(new Request('https://pay.ubq.fi/x', {
      headers: {
        cookie: 'session=abc',
        origin: 'https://pay.ubq.fi',
        referer: 'https://evil.example/',
      },
    }), {} as Env)

    expect(seen.value?.get('cookie')).toBe('session=abc')
    expect(seen.value?.get('origin')).toBe('https://pay.ubq.fi')
    expect(seen.value?.get('referer')).toBe(null)
    expect(seen.value?.get('x-forwarded-host')).toBe('pay.ubq.fi')
    expect(seen.value?.get('x-forwarded-proto')).toBe('https')
  })

  test('VPS attempts carry the original host as x-forwarded-host', async () => {
    const seen: { value: Headers | null } = { value: null }
    mockFetch((req) => {
      seen.value = req.headers
      return new Response('ok')
    })

    await worker.fetch(new Request('https://auth.ubq.fi/login', {
      headers: { cookie: 'hub=1' },
    }), mappedEnv)

    expect(seen.value?.get('x-forwarded-host')).toBe('auth.ubq.fi')
    expect(seen.value?.get('cookie')).toBe('hub=1')
  })

  test('returns 502 with the router revision when every origin fails', async () => {
    mockFetch(() => {
      throw new Error('all down')
    })

    const res = await worker.fetch(new Request('https://auth.ubq.fi/health'), mappedEnv)

    expect(res.status).toBe(502)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
  })
})
