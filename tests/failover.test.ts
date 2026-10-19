import { afterEach, describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const env = { VPS_ORIGIN_MAP: '{"passport.ubq.fi":"origin.ubq.fi"}' } as Env

describe('router headers and origin reporting', () => {
  test('always tags responses with the router revision and origin', async () => {
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://passport.ubq.fi/health'), env)

    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(res.headers.get('x-uos-router-origin')).toBe('vps')
  })

  test('does not leak the failover header anymore', async () => {
    globalThis.fetch = (async () => new Response('ok')) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://passport.ubq.fi/health'), env)

    expect(res.headers.get('x-uos-router-failover')).toBe(null)
  })
})
