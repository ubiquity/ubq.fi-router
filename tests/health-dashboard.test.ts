import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import type { HealthSnapshot } from '../src/health-dashboard/api'
import worker, { type Env, resetOriginHealth } from '../src/worker'

const originalFetch = globalThis.fetch
const originalNow = Date.now
const originalTimeout = AbortSignal.timeout
const apiUrl = 'https://health.ubq.fi/api/health'
const passingRun = { id: 42, status: 'completed', conclusion: 'success', updated_at: '2026-11-01T12:00:00Z' }

afterEach(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
  AbortSignal.timeout = originalTimeout
  resetOriginHealth()
})

function configuration(name: string, extra: Record<string, unknown> = {}): Env {
  return { HEALTH_CHECKS: JSON.stringify([{ name, repository: 'ubiquity/app', ...extra }]) }
}

function mockFetch(handler: (request: Request) => Response | Promise<Response>): Request[] {
  const calls: Request[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    calls.push(request)
    return await handler(request)
  }) as typeof fetch
  return calls
}

function runs(...values: unknown[]): Response {
  return Response.json({ workflow_runs: values })
}

async function health(env: Env) {
  const response = await worker.fetch(new Request(apiUrl), env)
  return { response, body: await response.json() as HealthSnapshot }
}

describe('health dashboard routing', () => {
  test('serves a self-contained page and HEAD without contacting GitHub or the VPS', async () => {
    const calls = mockFetch(() => {
      throw new Error('Unexpected fetch')
    })
    const env = { VPS_ORIGIN_MAP: '{"health.ubq.fi":"origin.ubq.fi"}' }
    const response = await worker.fetch(new Request('https://health.ubq.fi/'), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-uos-router-revision')).toBe('local')
    const page = await response.text()
    expect(page).toContain('Ubiquity Health')
    expect(page).toContain('/api/health')
    expect(page).toContain('<noscript>')
    const head = await worker.fetch(new Request('https://health.ubq.fi/', { method: 'HEAD' }), env)
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(calls).toHaveLength(0)
  })

  test.each(['/', '/api/health'])('rejects writes and handles preflight at %s without fetching', async (path) => {
    const calls = mockFetch(() => {
      throw new Error('Unexpected fetch')
    })
    const response = await worker.fetch(new Request(`https://health.ubq.fi${path}`, { method: 'POST' }), {})
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, HEAD, OPTIONS')
    const options = await worker.fetch(new Request(`https://health.ubq.fi${path}`, { method: 'OPTIONS' }), {})
    expect(options.status).toBe(204)
    if (path === '/api/health') {
      expect(options.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(options.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS')
    }
    expect(calls).toHaveLength(0)
  })

  test('does not claim other hosts, liveness, or legacy health-host paths', async () => {
    const calls = mockFetch(() => new Response('legacy VPS'))
    for (const host of ['ubq.fi', 'health.ubq.fi.example.com']) {
      expect((await worker.fetch(new Request(`https://${host}/api/health`), {})).status).toBe(410)
    }
    const live = await worker.fetch(new Request('https://health.ubq.fi/__health'), {})
    expect((await live.json() as { status: string }).status).toBe('ok')
    expect(calls).toHaveLength(0)
    const legacy = await worker.fetch(new Request('https://health.ubq.fi/legacy'), {
      VPS_ORIGIN_MAP: '{"health.ubq.fi":"origin.ubq.fi"}',
    })
    expect(await legacy.text()).toBe('legacy VPS')
    expect(calls[0].url).toBe('https://origin.ubq.fi/legacy')
  })
})

describe('CI health API', () => {
  test('defaults to router CI on main and exposes a public, timestamped snapshot', async () => {
    const calls = mockFetch(() => runs(passingRun))
    const { response, body } = await health({})
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('x-uos-router-revision')).toBe('local')
    expect(body.status).toBe('operational')
    expect(Number.isFinite(Date.parse(body.updatedAt))).toBe(true)
    expect(body.checks[0]).toEqual({
      name: 'Router',
      repository: 'ubiquity/ubq.fi-router',
      workflow: 'ci.yml',
      branch: 'main',
      status: 'operational',
      updatedAt: passingRun.updated_at,
      url: 'https://github.com/ubiquity/ubq.fi-router/actions/runs/42',
    })
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/ubiquity/ubq.fi-router/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=1',
    )
    expect(calls[0].headers.has('Authorization')).toBe(false)
  })

  test('uses configured test workflows, branches and a server-only token, including for HEAD', async () => {
    const calls = mockFetch(() => runs(passingRun))
    const env = {
      ...configuration('Plugin', { workflow: 'tests.yaml', branch: 'release/next' }),
      GITHUB_TOKEN: 'test-only-token',
    }
    const response = await worker.fetch(new Request(apiUrl, { method: 'HEAD' }), env)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    const { body } = await health(env)
    expect(JSON.stringify(body)).not.toContain(env.GITHUB_TOKEN)
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/repos/ubiquity/app/actions/workflows/tests.yaml/runs')
    expect(url.searchParams.get('branch')).toBe('release/next')
    expect(url.searchParams.get('event')).toBe('push')
    expect(url.searchParams.has('status')).toBe(false)
    expect(calls[0].headers.get('Authorization')).toBe('Bearer test-only-token')
    expect(calls[0].redirect).toBe('error')
    expect(calls[0].signal).toBeInstanceOf(AbortSignal)
  })

  test.each([
    ['completed', 'success', 'operational'],
    ...['failure', 'timed_out', 'action_required', 'startup_failure'].map(
      (conclusion) => ['completed', conclusion, 'degraded'],
    ),
    ...['queued', 'in_progress', 'requested', 'waiting', 'pending'].map((status) => [status, null, 'pending']),
    ...['cancelled', 'skipped', 'neutral', 'stale', null].map((conclusion) => ['completed', conclusion, 'unknown']),
    ['unrecognized', null, 'unknown'],
  ])('maps %s / %s to %s without a false green', async (status, conclusion, expected) => {
    mockFetch(() => runs({ ...passingRun, status, conclusion }))
    const { response, body } = await health(configuration(`${status}-${conclusion}`))
    expect(body.checks[0].status).toBe(expected)
    expect(body.status).toBe(expected === 'pending' ? 'unknown' : expected)
    expect(response.status).toBe(expected === 'operational' ? 200 : 503)
  })

  test('aggregates apps/plugins and gives failures precedence over missing results', async () => {
    mockFetch((request) => request.url.includes('/plugin/') ? runs({ ...passingRun, conclusion: 'failure' }) : runs())
    const { response, body } = await health({
      HEALTH_CHECKS: JSON.stringify([
        { repository: 'ubiquity/app' },
        { name: 'Plugin', repository: 'ubiquity-os/plugin' },
      ]),
    })
    expect(response.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.map((check: { status: string }) => check.status)).toEqual(['unknown', 'degraded'])
    expect(body.checks[0].name).toBe('ubiquity/app')
  })

  test.each([403, 404, 429, 500])('reports GitHub HTTP %s as unknown', async (status) => {
    mockFetch(() => new Response('upstream private details', { status }))
    const { response, body } = await health(configuration(`http-${status}`))
    expect(response.status).toBe(503)
    expect(body.status).toBe('unknown')
    expect(body.checks[0].error).toBe(`GitHub returned ${status}`)
    expect(JSON.stringify(body)).not.toContain('private details')
  })

  test.each(['network', 'timeout', 'invalid JSON', 'null', 'missing runs', 'bad run'])(
    'handles %s safely',
    async (failure) => {
      if (failure === 'timeout') {
        spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
          expect(ms).toBe(5_000)
          return AbortSignal.abort()
        })
      }
      mockFetch((request) => {
        request.signal.throwIfAborted()
        if (failure === 'network') throw new Error('private network details')
        if (failure === 'invalid JSON') return new Response('not JSON')
        if (failure === 'null') return Response.json(null)
        if (failure === 'bad run') return runs('bad run')
        return Response.json({})
      })
      const { response, body } = await health(configuration(failure))
      expect(response.status).toBe(503)
      expect(body.status).toBe('unknown')
      expect(body.checks[0].status).toBe('unknown')
      expect(JSON.stringify(body)).not.toContain('private network details')
    },
  )

  test('handles an invalid server token without exposing it or throwing', async () => {
    const calls = mockFetch(() => {
      throw new Error('Unexpected fetch')
    })
    const { response, body } = await health({ ...configuration('Invalid token'), GITHUB_TOKEN: 'invalid\r\ntoken' })
    expect(response.status).toBe(503)
    expect(body.checks[0].status).toBe('unknown')
    expect(JSON.stringify(body)).not.toContain('invalid\\r\\ntoken')
    expect(calls).toHaveLength(0)
  })

  test('does not publish invalid run URLs or timestamps', async () => {
    mockFetch(() =>
      runs({ ...passingRun, id: 'javascript:alert(1)', html_url: 'javascript:alert(1)', updated_at: 'bad time' })
    )
    const { body } = await health(configuration('invalid run metadata'))
    expect(body.checks[0].url).toBeUndefined()
    expect(body.checks[0].updatedAt).toBeUndefined()
  })

  test.each([
    '',
    '{oops',
    'null',
    '[]',
    '{}',
    '[null]',
    '[42]',
    '[{}]',
    '[{"repository":"https://evil.example/app"}]',
    '[{"repository":"ubiquity/.."}]',
    '[{"repository":"../app"}]',
    '[{"repository":"ubiquity/app","workflow":"../test.yml"}]',
    '[{"repository":"ubiquity/app","branch":""}]',
    '[{"repository":"ubiquity/app","name":42}]',
    '[{"repository":"ubiquity/app","branch":42}]',
    JSON.stringify(Array.from({ length: 21 }, () => ({ repository: 'ubiquity/app' }))),
  ])('rejects invalid configuration without fetching (%#)', async (raw) => {
    const calls = mockFetch(() => {
      throw new Error('Unexpected fetch')
    })
    const { response, body } = await health({ HEALTH_CHECKS: raw })
    expect(response.status).toBe(503)
    expect(body.status).toBe('unknown')
    expect(body.checks).toEqual([])
    expect(body.error).toBe('Invalid HEALTH_CHECKS configuration')
    expect(calls).toHaveLength(0)
  })

  test('coalesces concurrent requests, expires the cache, and isolates token/config changes', async () => {
    let now = originalNow()
    spyOn(Date, 'now').mockImplementation(() => now)
    let finish: (response: Response) => void = () => {}
    const calls = mockFetch(() =>
      new Promise<Response>((resolve) => {
        finish = resolve
      })
    )
    const env = configuration('Cache')
    const first = health(env)
    const second = health(env)
    expect(calls).toHaveLength(1)
    finish(runs(passingRun))
    expect((await first).body).toEqual((await second).body)
    await health(env)
    expect(calls).toHaveLength(1)
    now += 60_001
    const expired = health(env)
    expect(calls).toHaveLength(2)
    finish(runs({ ...passingRun, conclusion: 'failure' }))
    expect((await expired).body.status).toBe('degraded')
    const newToken = health({ ...env, GITHUB_TOKEN: 'another-test-token' })
    expect(calls).toHaveLength(3)
    finish(runs(passingRun))
    await newToken
    const newConfig = health(configuration('Another check'))
    expect(calls).toHaveLength(4)
    finish(runs(passingRun))
    await newConfig
  })
})

class PageElement {
  textContent = ''
  href = ''
  dataset: Record<string, string> = {}
  children: PageElement[] = []
  append(...children: PageElement[]) {
    this.children.push(...children)
  }
  replaceChildren() {
    this.children = []
  }
}

test.each(['operational', 'degraded', 'unknown'])(
  'dashboard script renders %s results safely and marks stale results unknown',
  async (status) => {
    const page = await (await worker.fetch(new Request('https://health.ubq.fi/'), {})).text()
    const script = page.match(/<script>([\s\S]*?)<\/script>/)![1]
    const elements = { overall: new PageElement(), updated: new PageElement(), checks: new PageElement() }
    let retry: () => Promise<void> = () => Promise.resolve()
    let unavailable = false
    const rendered = runInNewContext(script, {
      document: {
        getElementById: (id: keyof typeof elements) => elements[id],
        createElement: () => new PageElement(),
      },
      fetch: (url: string) => {
        expect(url).toBe('/api/health')
        if (unavailable) return Promise.reject(new Error('offline'))
        return Promise.resolve(Response.json({
          status,
          updatedAt: passingRun.updated_at,
          checks: [{
            name: '<img src=x onerror=alert(1)>',
            repository: 'ubiquity/plugin',
            status,
            updatedAt: passingRun.updated_at,
            url: 'https://github.com/ubiquity/plugin/actions/runs/42',
          }, {
            name: 'Unavailable plugin',
            repository: 'ubiquity/plugin',
            status: 'unknown',
            error: 'CI status unavailable',
          }],
        }, { status: status === 'operational' ? 200 : 503 }))
      },
      AbortSignal,
      setTimeout: (callback: () => Promise<void>, ms: number) => {
        expect(ms).toBe(60_000)
        retry = callback
      },
    })
    await rendered
    expect(elements.overall.dataset.status).toBe(status)
    expect(elements.overall.textContent).toBe(
      status === 'operational'
        ? 'All monitored tests passing'
        : status === 'degraded'
        ? 'Some monitored tests failing'
        : 'Test status not yet known',
    )
    const cells = elements.checks.children[0].children
    expect(cells[0].children[0].textContent).toBe('<img src=x onerror=alert(1)>')
    expect(cells[0].children[0].href).toBe('https://github.com/ubiquity/plugin/actions/runs/42')
    expect(cells[1].textContent).toBe(
      status === 'operational' ? 'Passing' : status === 'degraded' ? 'Failing' : 'Unknown',
    )
    const unavailableCells = elements.checks.children[1].children
    expect(unavailableCells[0].children[0].href).toBe('https://github.com/ubiquity/plugin/actions')
    expect(unavailableCells[1].textContent).toBe('CI status unavailable')
    expect(unavailableCells[2].textContent).toBe('No run available')
    unavailable = true
    await retry()
    expect(elements.overall.dataset.status).toBe('unknown')
    expect(elements.updated.textContent).toContain('out of date')
  },
)
