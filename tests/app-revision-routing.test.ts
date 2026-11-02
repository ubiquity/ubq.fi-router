import { afterEach, describe, expect, test } from 'bun:test'
import worker, { type Env, resetOriginHealth } from '../src/worker'

const originalFetch = globalThis.fetch
const sha = '1234567890abcdef1234567890abcdef12345678'
const nextSha = 'abcdef1234567890abcdef1234567890abcdef12'
const html = '<html><body><main>App</main><footer>Footer</footer></body></html>'
const config = Bun.TOML.parse(await Bun.file(new URL('../wrangler.toml', import.meta.url)).text()) as {
  vars: Env
  routes: { pattern: string; zone_name: string }[]
  services: { binding: keyof Env; service: string }[]
}
const apps: [string, keyof Env, string, string][] = [
  ['ubq.fi', 'APP_UBQ', 'ubq-fi', 'ubiquity/ubq.fi'],
  ['stake.ubq.fi', 'APP_STAKE', 'stake-ubq-fi', 'ubiquity/stake.ubq.fi'],
  ['xp.ubq.fi', 'APP_XP', 'xp-ubq-fi', 'ubiquity/xp.ubq.fi'],
  ['notifications.ubq.fi', 'APP_NOTIFICATIONS', 'notifications-ubq-fi', 'ubiquity/notifications.ubq.fi'],
  ['demo.ubq.fi', 'APP_DEMO', 'demo-ubq-fi', 'ubiquity/demo.ubq.fi'],
  ['onboard.ubq.fi', 'APP_ONBOARD', 'onboard-ubq-fi', 'ubiquity/onboard.ubq.fi'],
  ['card.ubq.fi', 'APP_CARD', 'card-ubq-fi', 'ubiquity/card.ubq.fi'],
  ['keygen.ubq.fi', 'APP_KEYGEN', 'keygen-ubq-fi', 'ubiquity/keygen.ubq.fi'],
  ['work.ubq.fi', 'APP_WORK', 'work-ubq-fi', 'ubiquity/work.ubq.fi'],
  ['partner.ubq.fi', 'APP_PARTNER', 'partner-ubq-fi', 'ubiquity/partner.ubq.fi'],
  ['pay.ubq.fi', 'APP_PAY', 'pay-ubq-fi', 'ubiquity/pay.ubq.fi'],
  ['kv.ubq.fi', 'APP_KV', 'ubq-kv', 'ubiquity/ubq-kv'],
]

function metadataFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    return Promise.resolve(handler(url, init))
  }) as typeof fetch
  return calls
}

function appEnv(response = () => new Response(html, { headers: { 'content-type': 'text/html' } })): Env {
  return { ...config.vars, APP_STAKE: { fetch: () => Promise.resolve(response()) } }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  resetOriginHealth()
})

describe('production revision footer integration', () => {
  test.each(apps)(
    '%s has a front-door route, service origin and metadata source',
    async (host, binding, service, repository) => {
      expect(config.services).toContainEqual({ binding, service })
      for (const scheme of ['http', 'https']) {
        expect(config.routes).toContainEqual({ pattern: `${scheme}://${host}/*`, zone_name: 'ubq.fi' })
      }
      const calls = metadataFetch((url, init) => {
        expect(url).toBe(`https://api.github.com/repos/${repository}/commits?per_page=1`)
        expect(new Headers(init?.headers).get('user-agent')).toBe('ubq-fi-router')
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        return Response.json([{ sha }])
      })
      const request = new Request(`https://${host}/nested/page?debug=1`, {
        headers: { cookie: 'session=1', origin: `https://${host}` },
      })
      const forwarded: Request[] = []
      const env = {
        ...config.vars,
        [binding]: {
          fetch: (req: Request) => {
            forwarded.push(req)
            // Existing apps need only return HTML, not new revision headers.
            return Promise.resolve(new Response(html, { headers: { 'content-type': 'text/html', etag: 'old' } }))
          },
        },
      } as Env
      const response = await worker.fetch(request, env)
      const body = await response.text()
      expect(forwarded).toEqual([request])
      expect(body).toContain(`<footer>Footer<style>`)
      expect(body).toContain(`href="https://github.com/${repository}/commit/${sha}"`)
      expect(body).toContain('>1234567</a></footer>')
      expect(body).toContain('Latest source revision (deployment not reported)')
      expect(body).not.toContain('❔')
      expect(response.headers.get('x-uos-router-origin')).toBe('worker')
      expect(response.headers.has('x-uos-router-revision')).toBe(true)
      expect(response.headers.has('etag')).toBe(false)
      expect(calls).toHaveLength(1)
    },
  )

  test.each([
    ['passport.ubq.fi', 'ubiquity/ubiquity-passport'],
    ['ai.ubq.fi', 'ubiquity/ai.ubq.fi'],
    ['checkout.ubq.fi', 'ubiquity/checkout.ubq.fi'],
    ['health.ubq.fi', 'ubiquity/health.ubq.fi'],
  ])('VPS app %s also works without revision headers', async (host, repository) => {
    const calls = metadataFetch((url) =>
      url.startsWith('https://origin.ubq.fi/')
        ? new Response(html, { headers: { 'content-type': 'text/html' } })
        : Response.json([{ sha }])
    )
    // The router owns the health dashboard root; legacy paths still reach the VPS app.
    const response = await worker.fetch(new Request(`https://${host}/legacy`), config.vars)
    expect(await response.text()).toContain(`https://github.com/${repository}/commit/${sha}`)
    expect(response.headers.get('x-uos-router-origin')).toBe('vps')
    expect(calls).toEqual([
      'https://origin.ubq.fi/legacy',
      `https://api.github.com/repos/${repository}/commits?per_page=1`,
    ])
  })

  test('does not bake a hash into the router deployment', async () => {
    let currentSha = sha
    metadataFetch(() => Response.json([{ sha: currentSha }]))
    const request = new Request('https://stake.ubq.fi/')
    expect(await (await worker.fetch(request, appEnv())).text()).toContain(`/commit/${sha}`)
    currentSha = nextSha
    expect(await (await worker.fetch(request, appEnv())).text()).toContain(`/commit/${nextSha}`)
  })

  test('keeps a reported deployed revision rather than looking up repository HEAD', async () => {
    const calls = metadataFetch(() => {
      throw new Error('unexpected metadata fetch')
    })
    const env = appEnv(() =>
      new Response(html, {
        headers: {
          'content-type': 'text/html',
          'x-app-repository': 'ubiquity/stake.ubq.fi',
          'x-app-revision': sha,
        },
      })
    )
    const body = await (await worker.fetch(new Request('https://stake.ubq.fi/'), env)).text()
    expect(body).toContain(`/commit/${sha}`)
    expect(body).toContain('Deployed revision:')
    expect(body).not.toContain('Latest source revision')
    expect(calls).toHaveLength(0)
  })

  test.each([null, {}, [], [{ sha: 'not-a-sha' }], [{ sha: '"><script>alert(1)</script>' }]])(
    'fails open for invalid GitHub metadata: %j',
    async (data) => {
      metadataFetch(() => Response.json(data))
      const response = await worker.fetch(new Request('https://stake.ubq.fi/'), appEnv())
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(html)
    },
  )

  test.each([403, 404, 429, 503])('fails open on GitHub HTTP %s', async (status) => {
    metadataFetch(() => new Response('unavailable', { status }))
    expect(await (await worker.fetch(new Request('https://stake.ubq.fi/'), appEnv())).text()).toBe(html)
  })

  test('fails open on a metadata network/timeout error', async () => {
    metadataFetch(() => {
      throw new DOMException('Timeout', 'TimeoutError')
    })
    expect(await (await worker.fetch(new Request('https://stake.ubq.fi/'), appEnv())).text()).toBe(html)
  })

  test.each(['HEAD', 'application/json', 'text/event-stream'])('does not fetch metadata for %s', async (kind) => {
    const calls = metadataFetch(() => {
      throw new Error('unexpected metadata fetch')
    })
    const method = kind === 'HEAD' ? 'HEAD' : 'GET'
    const env = appEnv(() =>
      new Response(method === 'HEAD' ? null : '{}', {
        headers: { 'content-type': kind === 'HEAD' ? 'text/html' : kind },
      })
    )
    await worker.fetch(new Request('https://stake.ubq.fi/', { method }), env)
    expect(calls).toHaveLength(0)
  })

  test('does not fall back to a recursive public fetch when a binding is absent or fails', async () => {
    const calls = metadataFetch(() => {
      throw new Error('unexpected public fetch')
    })
    const request = new Request('https://stake.ubq.fi/')
    const missing = await worker.fetch(request, config.vars)
    expect(missing.status).toBe(502)
    expect(missing.headers.has('x-uos-router-revision')).toBe(true)
    const env = { ...config.vars, APP_STAKE: { fetch: () => Promise.reject(new Error('Worker unavailable')) } }
    expect((await worker.fetch(request, env)).status).toBe(502)
    expect(calls).toHaveLength(0)
  })
})
