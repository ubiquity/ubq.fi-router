import { describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'
import { buildRouteMap } from '../src/sitemap'

const githubResponse = [
  { name: 'ubq.fi' },
  { name: 'pay.ubq.fi' },
  { name: 'ubiquity-os-kernel' },
  { name: 'old.ubq.fi', archived: true },
]

describe('dynamic route map', () => {
  test('builds JSON route map from active GitHub repos', async () => {
    globalThis.fetch = (async () => Response.json(githubResponse)) as unknown as typeof fetch

    const entries = await buildRouteMap('https://ubq.fi')

    expect(entries).toEqual([
      {
        type: 'plugin',
        name: 'ubiquity-os-kernel',
        host: 'os-kernel.ubq.fi',
        url: 'https://os-kernel.ubq.fi/',
        upstream: 'https://kernel-main.deno.dev/',
      },
      {
        type: 'app',
        name: 'pay.ubq.fi',
        host: 'pay.ubq.fi',
        url: 'https://pay.ubq.fi/',
        upstream: 'https://pay-ubq-fi.ubiquity-dao.deno.net/',
      },
      {
        type: 'app',
        name: 'ubq.fi',
        host: 'ubq.fi',
        url: 'https://ubq.fi/',
        upstream: 'https://ubq-fi.ubiquity-dao.deno.net/',
      },
    ])
  })

  test('serves sitemap xml through the worker', async () => {
    globalThis.fetch = (async () => Response.json(githubResponse)) as unknown as typeof fetch

    const res = await worker.fetch(new Request('https://ubq.fi/sitemap.xml'), {} as Env)
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(res.headers.get('x-uos-router-revision')).toBe('local')
    expect(body).toContain('<loc>https://pay.ubq.fi/</loc>')
    expect(body).toContain('<loc>https://os-kernel.ubq.fi/</loc>')
  })
})
