import { describe, expect, test } from 'bun:test'
import worker, { type Env } from '../src/worker'
import {
  generateSitemapXml,
  generateSitemapJson,
  generatePluginsJson,
  getFullAppList,
  getFullPluginList,
  KNOWN_APPS,
  KNOWN_PLUGINS,
} from '../src/utils/sitemap'

describe('Dynamic Sitemap & Plugin Map Generator', () => {
  test('lists all known core apps and plugins correctly', () => {
    const apps = getFullAppList()
    const plugins = getFullPluginList()

    expect(apps.length).toBe(KNOWN_APPS.length)
    expect(plugins.length).toBe(KNOWN_PLUGINS.length)

    expect(apps.some((a) => a.hostname === 'ubq.fi')).toBe(true)
    expect(apps.some((a) => a.hostname === 'work.ubq.fi')).toBe(true)
    expect(apps.some((a) => a.hostname === 'pay.ubq.fi')).toBe(true)
    expect(apps.some((a) => a.hostname === 'ai.ubq.fi')).toBe(true)

    expect(plugins.some((p) => p.hostname === 'os-command-start-stop.ubq.fi')).toBe(true)
    expect(plugins.some((p) => p.hostname === 'os-kernel.ubq.fi')).toBe(true)
  })

  test('generates valid XML sitemap with XML headers, changefreq, and priority', () => {
    const xml = generateSitemapXml('2026-08-20T00:00:00.000Z')

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
    expect(xml.includes('<loc>https://ubq.fi/</loc>')).toBe(true)
    expect(xml.includes('<loc>https://work.ubq.fi/</loc>')).toBe(true)
    expect(xml.includes('<loc>https://os-command-start-stop.ubq.fi/</loc>')).toBe(true)
    expect(xml.includes('<lastmod>2026-08-20</lastmod>')).toBe(true)
    expect(xml.includes('</urlset>')).toBe(true)
  })

  test('generates structured JSON sitemap matching specification', () => {
    const json = generateSitemapJson('2026-08-20T00:00:00.000Z')

    expect(json.schemaVersion).toBe('1.0.0')
    expect(json.domain).toBe('ubq.fi')
    expect(json.totalEntries).toBe(json.apps.length + json.plugins.length)
    expect(json.apps.length).toBeGreaterThan(0)
    expect(json.plugins.length).toBeGreaterThan(0)

    const rootApp = json.apps.find((a) => a.hostname === 'ubq.fi')
    expect(rootApp).toBeDefined()
    expect(rootApp?.priority).toBe(1.0)
  })

  test('generates plugins JSON compilation for system interoperability', () => {
    const json = generatePluginsJson('2026-08-20T00:00:00.000Z')

    expect(json.schemaVersion).toBe('1.0.0')
    expect(json.totalPlugins).toBe(json.plugins.length)
    expect(json.plugins.length).toBeGreaterThan(0)

    const kernel = json.plugins.find((p) => p.type === 'kernel')
    expect(kernel).toBeDefined()
    expect(kernel?.hostname).toBe('os-kernel.ubq.fi')
    expect(kernel?.targetDenoUrl).toBe('https://kernel-main.deno.dev/')
  })
})

describe('Worker sitemap routing endpoints', () => {
  test('serves /sitemap.xml with correct content type and caching', async () => {
    const req = new Request('https://ubq.fi/sitemap.xml')
    const res = await worker.fetch(req, {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(res.headers.get('x-uos-router-revision')).toBe('local')

    const text = await res.text()
    expect(text).toContain('<urlset')
    expect(text).toContain('https://work.ubq.fi/')
  })

  test('serves /sitemap.json with correct json payload and headers', async () => {
    const req = new Request('https://ubq.fi/sitemap.json')
    const res = await worker.fetch(req, {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('x-uos-router-revision')).toBe('local')

    const data = await res.json()
    expect(data.schemaVersion).toBe('1.0.0')
    expect(data.apps.length).toBeGreaterThan(0)
  })

  test('serves /plugins.json with plugins list', async () => {
    const req = new Request('https://ubq.fi/plugins.json')
    const res = await worker.fetch(req, {} as Env)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('x-uos-router-revision')).toBe('local')

    const data = await res.json()
    expect(data.schemaVersion).toBe('1.0.0')
    expect(data.totalPlugins).toBeGreaterThan(0)
  })
})
