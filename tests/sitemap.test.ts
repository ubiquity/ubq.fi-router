import { afterEach, describe, expect, test } from 'bun:test'
import type { HealthSnapshot } from '../src/health-dashboard/api'
import { discoverAppMap, discoverPluginMap, mapStatus, type MapEntry } from '../src/plugin-map-discovery'
import { generateSitemap, handleSitemap } from '../src/sitemap-generator'
import worker, { type Env } from '../src/worker'

const originalFetch = globalThis.fetch
const originalNow = Date.now
const paths = ['/sitemap.xml', '/sitemap.json', '/plugin-map.xml', '/plugin-map.json']
const passingRun = { id: 42, status: 'completed', conclusion: 'success', updated_at: '2026-11-01T12:00:00Z' }

afterEach(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
})

function configuration(name: string, checks: Record<string, unknown>[] = [{ repository: 'ubiquity/ubq.fi' }]): Env {
  return { HEALTH_CHECKS: JSON.stringify(checks.map((check) => ({ name, ...check }))) }
}

function mockGitHub(handler: (request: Request) => Response | Promise<Response> = () =>
  Response.json({ workflow_runs: [passingRun] })
): Request[] {
  const calls: Request[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    calls.push(request)
    return handler(request)
  }) as typeof fetch
  return calls
}

async function request(path: string, env: Env, method = 'GET') {
  return worker.fetch(new Request(`https://ubq.fi${path}`, { method }), env)
}

interface Inventory {
  kind: string
  status: string
  updatedAt: string
  entries: MapEntry[]
  error?: string
}

async function inventory(path: string, env: Env): Promise<Inventory> {
  return (await request(path, env)).json() as Promise<Inventory>
}

describe('infrastructure map discovery', () => {
  test.each([
    [[], 'unknown'],
    [['operational'], 'operational'],
    [['operational', 'pending'], 'pending'],
    [['operational', 'unknown'], 'unknown'],
    [['unknown', 'degraded', 'pending'], 'degraded'],
  ] as const)('aggregates %j as %s without assuming unchecked services pass', (statuses, expected) => {
    expect(mapStatus(statuses.map((status) => ({ status })))).toBe(expected)
  })

  test('discovers, deduplicates and sorts plugins, retaining every workflow result', () => {
    const check = { name: 'Plugin', repository: 'ubiquity-os/Plugin', workflow: 'ci.yml', branch: 'main' }
    const health: HealthSnapshot = {
      status: 'degraded', updatedAt: '2026-11-01T12:00:00Z', checks: [
        { ...check, kind: 'plugin', status: 'operational' },
        { ...check, kind: 'plugin', workflow: 'routing.yml', status: 'degraded' },
        { ...check, kind: 'plugin', siteUrl: 'https://a.example/hook', status: 'pending' },
        { ...check, kind: 'app', siteUrl: 'https://app.example/', status: 'unknown' },
      ],
    }
    const entries = discoverPluginMap(health)
    expect(entries.map((entry) => entry.url)).toEqual(['https://a.example/hook', 'https://github.com/ubiquity-os/plugin'])
    expect(entries.map((entry) => entry.status)).toEqual(['pending', 'degraded'])
    expect(entries[1].checks).toHaveLength(2)
    const apps = discoverAppMap(health, [{ url: 'https://unmonitored.ubq.fi/' }])
    expect(apps.map((entry) => entry.url)).toEqual(['https://app.example/', 'https://unmonitored.ubq.fi/'])
    expect(apps[1]).toMatchObject({ name: 'unmonitored.ubq.fi', status: 'unknown', checks: [] })
  })

  test('retains all checks when multiple repositories describe the same app URL', () => {
    const check = { name: 'App', workflow: 'ci.yml', branch: 'main' }
    const health: HealthSnapshot = {
      status: 'degraded', updatedAt: '2026-11-01T12:00:00Z', checks: [
        { ...check, repository: 'UBIQUITY/app', status: 'operational' },
        { ...check, repository: 'ubiquity/app', workflow: 'routing.yml', status: 'degraded' },
        { ...check, repository: 'ubiquity/backend', siteUrl: 'https://app.ubq.fi/', status: 'pending' },
      ],
    }
    const apps = discoverAppMap(health, [{ url: 'https://app.ubq.fi/', repository: 'ubiquity/app' }])
    expect(apps).toHaveLength(1)
    expect(apps[0].repository).toBe('ubiquity/app')
    expect(apps[0].checks).toHaveLength(3)
    expect(apps[0].status).toBe('degraded')
  })

  test('XML escapes all text and strips invalid XML code points without losing Unicode', () => {
    const entries: MapEntry[] = [{
      url: 'https://plugin.example/hook?a=1&b=2', repository: 'ubiquity-os/plugin',
      name: `A & <B> "C" 'D'\u0000\uD800 🛰`, status: 'unknown',
      checks: [{ name: 'Check', repository: 'ubiquity-os/plugin', workflow: 'ci.yml', branch: 'a&<b>', status: 'unknown', error: 'Unavailable & retrying' }],
    }]
    const xml = generateSitemap(entries)
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(xml).toContain('<loc>https://plugin.example/hook?a=1&amp;b=2</loc>')
    expect(xml).toContain('<infra:name>A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos; 🛰</infra:name>')
    expect(xml).toContain('<infra:branch>a&amp;&lt;b&gt;</infra:branch>')
    expect(xml).toContain('<infra:error>Unavailable &amp; retrying</infra:error>')
    expect(xml).not.toContain('<lastmod>')
    expect(generateSitemap([])).not.toContain('<url>')
  })
})

describe('dynamic map endpoints', () => {
  test('uses the active app inventory and public CI results, never origin addresses or credentials', async () => {
    const calls = mockGitHub()
    const env = {
      ...configuration('Active apps', [{ repository: 'UBIQUITY/UBQ.FI' }]),
      GITHUB_TOKEN: 'map-private-value',
      VPS_ORIGIN_MAP: JSON.stringify({
        'passport.ubq.fi': 'private-origin.example', 'probe.ubq.fi': 'private-origin.example',
        'auth.ubq.fi': 'private-origin.example', 'not-ours.example': 'private-origin.example',
        'bad@host.ubq.fi': 'private-origin.example',
      }),
    }
    const response = await request('/sitemap.json', env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-uos-router-revision')).toBe('local')
    const text = await response.text()
    const map = JSON.parse(text) as Inventory
    expect(map.kind).toBe('apps')
    expect(map.status).toBe('unknown')
    expect(Number.isFinite(Date.parse(map.updatedAt))).toBe(true)
    expect(map.entries).toHaveLength(15)
    expect(map.entries.find((entry) => entry.url === 'https://ubq.fi/')).toMatchObject({
      repository: 'ubiquity/ubq.fi', status: 'operational',
      checks: [{ repository: 'UBIQUITY/UBQ.FI', status: 'operational', url: 'https://github.com/UBIQUITY/UBQ.FI/actions/runs/42' }],
    })
    expect(map.entries.find((entry) => entry.url === 'https://probe.ubq.fi/')).toMatchObject({ status: 'unknown', checks: [] })
    for (const host of ['stake.ubq.fi', 'kv.ubq.fi', 'health.ubq.fi', 'passport.ubq.fi']) {
      expect(map.entries.some((entry) => entry.url === `https://${host}/`)).toBe(true)
    }
    for (const hidden of ['private-origin.example', 'map-private-value', 'auth.ubq.fi', 'bad@host', 'not-ours.example']) {
      expect(text).not.toContain(hidden)
    }
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.get('authorization')).toBe('Bearer map-private-value')
  })

  test('publishes additional app and plugin URLs from the monitored GitHub repositories', async () => {
    mockGitHub((req) => Response.json({ workflow_runs: [{
      ...passingRun, conclusion: req.url.includes('/plugin/') ? 'failure' : 'success',
    }] }))
    const env = configuration('Configured URLs', [
      { repository: 'ubiquity/custom', kind: 'app', siteUrl: 'https://Custom.ubq.fi' },
      { repository: 'ubiquity-os/plugin', kind: 'plugin', siteUrl: 'https://plugins.example/hook?a=1&b=2' },
    ])
    const apps = await inventory('/sitemap.json', env)
    expect(apps.entries.find((entry) => entry.url === 'https://custom.ubq.fi/')).toMatchObject({ status: 'operational' })
    expect(apps.entries.some((entry) => entry.repository === 'ubiquity-os/plugin')).toBe(false)
    const plugins = await inventory('/plugin-map.json', env)
    expect(plugins.kind).toBe('plugins')
    expect(plugins.status).toBe('degraded')
    expect(plugins.entries).toHaveLength(1)
    expect(plugins.entries[0]).toMatchObject({ repository: 'ubiquity-os/plugin', status: 'degraded' })
    const xml = await request('/plugin-map.xml', env)
    expect(xml.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(await xml.text()).toContain('<loc>https://plugins.example/hook?a=1&amp;b=2</loc>')
  })

  test('shares cached in-flight checks across both maps, both formats and the dashboard, then refreshes', async () => {
    let now = originalNow()
    Date.now = () => now
    const calls = mockGitHub(async () => {
      await Promise.resolve()
      return Response.json({ workflow_runs: [{ ...passingRun, conclusion: calls.length > 1 ? 'failure' : 'success' }] })
    })
    const env = configuration('Shared snapshot', [{ repository: 'ubiquity-os/plugin', kind: 'plugin' }])
    const responses = await Promise.all(paths.map((path) => request(path, env)))
    expect(responses.every((response) => response.status === 200)).toBe(true)
    const health = await worker.fetch(new Request('https://health.ubq.fi/api/health'), env)
    const dashboard = await health.json() as HealthSnapshot
    const plugins = await responses[3].json() as Inventory
    const apps = await responses[1].json() as Inventory
    expect(plugins.updatedAt).toBe(dashboard.updatedAt)
    expect(apps.updatedAt).toBe(dashboard.updatedAt)
    expect(plugins.entries[0].checks).toEqual(dashboard.checks)
    expect(calls).toHaveLength(1)
    now += 60_001
    expect((await inventory('/plugin-map.json', env)).status).toBe('degraded')
    expect(calls).toHaveLength(2)
  })

  test.each(paths)('supports HEAD at %s', async (path) => {
    mockGitHub()
    const response = await request(path, configuration(`HEAD ${path}`), 'HEAD')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('content-type')).toContain(path.endsWith('json') ? 'application/json' : 'application/xml')
  })

  test.each(paths)('rejects writes and permits CORS preflight at %s without checking GitHub', async (path) => {
    const calls = mockGitHub(() => { throw new Error('Unexpected fetch') })
    const options = await request(path, {}, 'OPTIONS')
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(await options.text()).toBe('')
    const post = await request(path, {}, 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    expect(calls).toHaveLength(0)
  })

  test.each([
    { kind: 'other' }, { kind: null }, { siteUrl: 42 }, { siteUrl: null }, { siteUrl: '/relative' },
    { siteUrl: 'http://app.ubq.fi' }, { siteUrl: 'javascript:alert(1)' },
    { siteUrl: 'https://user:password@app.ubq.fi/' }, { siteUrl: 'https://app.ubq.fi/#fragment' },
  ])('rejects invalid public metadata without fetching (%#)', async (metadata) => {
    const calls = mockGitHub(() => { throw new Error('Unexpected fetch') })
    const env = configuration('Invalid metadata', [{ repository: 'ubiquity/app', ...metadata }])
    const response = await request('/sitemap.json', env)
    expect(response.status).toBe(503)
    expect((await response.json() as Inventory).error).toBe('Invalid HEALTH_CHECKS configuration')
    const xml = await request('/plugin-map.xml', env)
    expect(xml.status).toBe(503)
    expect(await xml.text()).toContain('<error>Invalid HEALTH_CHECKS configuration</error>')
    const head = await request('/sitemap.xml', env, 'HEAD')
    expect(head.status).toBe(503)
    expect(await head.text()).toBe('')
    expect(calls).toHaveLength(0)
  })

  test('unavailable GitHub results stay unknown and an empty plugin inventory is valid', async () => {
    mockGitHub(() => new Response(null, { status: 403 }))
    const env = configuration('Unavailable plugin', [{ repository: 'ubiquity-os/plugin', kind: 'plugin' }])
    const plugins = await inventory('/plugin-map.json', env)
    expect(plugins.status).toBe('unknown')
    expect(plugins.entries[0]).toMatchObject({ status: 'unknown', checks: [{ error: 'GitHub returned 403' }] })
    const empty = await inventory('/plugin-map.json', configuration('No plugins'))
    expect(empty.entries).toEqual([])
    expect(empty.status).toBe('unknown')
  })

  test('does not claim other hosts or paths and preserves upstream app sitemaps', async () => {
    const calls = mockGitHub(() => { throw new Error('Unexpected fetch') })
    for (const url of ['https://stake.ubq.fi/sitemap.xml', 'https://ubq.fi.example.com/sitemap.json', 'https://ubq.fi/sitemap.xml/']) {
      expect(await handleSitemap(new Request(url), {}, () => { throw new Error('Unexpected inventory') })).toBeNull()
    }
    const env: Env = { APP_STAKE: { fetch: async () => new Response('app sitemap') } }
    const upstream = await worker.fetch(new Request('https://stake.ubq.fi/sitemap.xml'), env)
    expect(await upstream.text()).toBe('app sitemap')
    const retired = await worker.fetch(new Request('https://retired.ubq.fi/plugin-map.json'), {})
    expect(retired.status).toBe(410)
    const legacy = await worker.fetch(new Request('https://auth.ubq.fi/sitemap.xml'), {})
    expect(legacy.status).toBe(308)
    expect(legacy.headers.get('location')).toBe('https://passport.ubq.fi/sitemap.xml')
    expect(calls).toHaveLength(0)
  })
})
