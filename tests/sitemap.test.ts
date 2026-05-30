import { describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'
import { buildJsonPluginMap, buildJsonSitemap, buildSitemapEntries, renderSitemapXml } from '../src/sitemap'

describe('dynamic sitemap generation', () => {
  test('builds sitemap entries for apps and plugins', () => {
    const entries = buildSitemapEntries()

    expect(entries.some((entry) => entry.loc === 'https://ubq.fi/')).toBe(true)
    expect(entries.some((entry) => entry.loc === 'https://pay.ubq.fi/')).toBe(true)
    expect(entries.some((entry) => entry.loc === 'https://os-command-config.ubq.fi/')).toBe(true)
  })

  test('renders XML sitemap with expected metadata', () => {
    const xml = renderSitemapXml([
      {
        loc: 'https://pay.ubq.fi/',
        lastmod: '2026-01-01',
        changefreq: 'daily',
        priority: 0.9,
      },
    ])

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<loc>https://pay.ubq.fi/</loc>')
    expect(xml).toContain('<priority>0.9</priority>')
  })

  test('builds JSON sitemap and plugin map', () => {
    const sitemap = buildJsonSitemap('2026-01-01T00:00:00.000Z')
    const pluginMap = buildJsonPluginMap('2026-01-01T00:00:00.000Z')

    expect(sitemap.total).toBe(sitemap.urls.length)
    expect(pluginMap.totalPlugins).toBe(pluginMap.plugins.length)
    expect(pluginMap.plugins[0].deployments.main.url).toContain('deno.dev')
  })

  test('serves sitemap and plugin map endpoints before proxy routing', async () => {
    const xml = await worker.fetch(new Request('https://ubq.fi/sitemap.xml'), {} as Env)
    const json = await worker.fetch(new Request('https://ubq.fi/sitemap.json'), {} as Env)
    const plugins = await worker.fetch(new Request('https://ubq.fi/plugins.json'), {} as Env)

    expect(xml.headers.get('content-type')).toContain('application/xml')
    expect(await xml.text()).toContain('<urlset')
    expect((await json.json()).total).toBeGreaterThan(0)
    expect((await plugins.json()).totalPlugins).toBeGreaterThan(0)
  })
})
