import { afterEach, describe, expect, test } from 'bun:test'
import worker, {
  markOriginDegraded,
  originIsDegraded,
  parseDegradedTtlMs,
  parseVpsOriginMap,
  proxyTimeoutMsForSubdomain,
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

const mappedEnv = { VPS_ORIGIN_MAP: '{"passport.ubq.fi":"origin.ubq.fi","ai.ubq.fi":"origin.ubq.fi"}' } as Env

describe('parseVpsOriginMap', () => {
  test('parses a valid map and normalizes case', () => {
    expect(parseVpsOriginMap('{"Passport.Ubq.Fi":"Origin.Ubq.Fi"}')).toEqual({ 'passport.ubq.fi': 'origin.ubq.fi' })
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

describe('health and timeouts', () => {
  test('answers /__health with the router revision', async () => {
    const res = await worker.fetch(new Request('https://ubq.fi/__health'), {} as Env)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  test('keeps the long timeout for ai routes', () => {
    expect(proxyTimeoutMsForSubdomain('ai')).toBe(900_000)
    expect(proxyTimeoutMsForSubdomain('pay')).toBe(30_000)
  })
})

describe('legacy auth redirect', () => {
  test.each(['GET', 'HEAD', 'POST'])('redirects %s permanently to the fixed Passport origin with its path and query', async (method) => {
    const calls = mockFetch(() => new Response('should not be reached'))
    const path = '//evil.example/authorize?client_id=example&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback'
    const res = await worker.fetch(new Request(`https://auth.ubq.fi${path}`, { method }), mappedEnv)

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(`https://passport.ubq.fi${path}`)
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(calls).toHaveLength(0)
  })

  test.each(['/__health', '/rpc/1'])('redirects legacy %s before special routing', async (path) => {
    const calls = mockFetch(() => new Response('should not be reached'))
    const res = await worker.fetch(new Request(`https://auth.ubq.fi${path}`), mappedEnv)

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(`https://passport.ubq.fi${path}`)
    expect(calls).toHaveLength(0)
  })

  test('does not redirect a hostname that only contains the legacy hostname', async () => {
    const res = await worker.fetch(new Request('https://auth.ubq.fi.evil.example/login'), mappedEnv)

    expect(res.status).toBe(410)
    expect(res.headers.get('location')).toBe(null)
  })
})

describe('VPS routing', () => {
  test('production map proxies Passport with the original host forwarded', async () => {
    const host = 'passport.ubq.fi'
    const config = Bun.TOML.parse(await Bun.file(new URL('../wrangler.toml', import.meta.url)).text()) as { vars: Env }
    const productionEnv = config.vars
    let seen: Headers | null = null
    const calls = mockFetch((req) => {
      seen = req.headers
      return new Response('vps-ok')
    })

    const res = await worker.fetch(new Request(`https://${host}/health`, {
      headers: { cookie: 'hub=1', origin: `https://${host}`, referer: 'https://evil.example/' },
    }), productionEnv)

    expect(await res.text()).toBe('vps-ok')
    expect(calls).toEqual(['https://origin.ubq.fi/health'])
    expect(res.headers.get('x-uos-router-origin')).toBe('vps')
    expect(seen!.get('x-forwarded-host')).toBe(host)
    expect(seen!.get('x-forwarded-proto')).toBe('https')
    expect(seen!.get('cookie')).toBe('hub=1')
    expect(seen!.get('origin')).toBe(`https://${host}`)
    expect(seen!.get('referer')).toBe(null)
    expect(seen!.get('cf-ray')).toBe(null)
  })

  test('hosts without a VPS origin answer 410 with zero fetches', async () => {
    const calls = mockFetch(() => new Response('should not be reached'))

    const res = await worker.fetch(new Request('https://preview-pay.ubq.fi/'), mappedEnv)

    expect(res.status).toBe(410)
    const body = (await res.json()) as { error: string; host: string }
    expect(body).toEqual({ error: 'service_retired', host: 'preview-pay.ubq.fi' })
    expect(calls).toHaveLength(0)
  })

  test('a retryable VPS status marks the origin degraded', async () => {
    const calls = mockFetch(() => new Response('down', { status: 503 }))

    const first = await worker.fetch(new Request('https://passport.ubq.fi/health'), mappedEnv)
    expect(first.status).toBe(503)
    expect(originIsDegraded('passport.ubq.fi::origin.ubq.fi')).toBe(true)

    const second = await worker.fetch(new Request('https://passport.ubq.fi/health'), mappedEnv)
    expect(second.status).toBe(502)
    const body = (await second.json()) as { error: string }
    expect(body.error).toBe('origin_degraded')
    expect(calls).toHaveLength(1)
  })

  test('a successful response clears the degraded marker', async () => {
    markOriginDegraded('passport.ubq.fi::origin.ubq.fi', 10_000)
    expect(originIsDegraded('passport.ubq.fi::origin.ubq.fi')).toBe(true)
    resetOriginHealth()
    expect(originIsDegraded('passport.ubq.fi::origin.ubq.fi')).toBe(false)
  })

  test('network failure answers 502 and marks the origin degraded', async () => {
    const calls = mockFetch(() => {
      throw new Error('connect timeout')
    })

    const res = await worker.fetch(new Request('https://passport.ubq.fi/health'), mappedEnv)

    expect(res.status).toBe(502)
    expect(calls).toHaveLength(1)
    expect(originIsDegraded('passport.ubq.fi::origin.ubq.fi')).toBe(true)
  })
})

describe('same-origin RPC', () => {
  test('proxies /rpc/:chainId to rpc.ubq.fi with CORS headers', async () => {
    const calls = mockFetch(() => new Response('{"result":"0x1"}', { headers: { 'content-type': 'application/json' } }))

    const res = await worker.fetch(new Request('https://ubq.fi/rpc/1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}',
    }), {} as Env)

    expect(res.status).toBe(200)
    expect(calls).toEqual(['https://rpc.ubq.fi/1'])
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('rejects non-numeric chain ids and handles preflight', async () => {
    const bad = await worker.fetch(new Request('https://ubq.fi/rpc/abc'), {} as Env)
    expect(bad.status).toBe(400)

    const preflight = await worker.fetch(new Request('https://ubq.fi/rpc/1', { method: 'OPTIONS' }), {} as Env)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
  })
})
