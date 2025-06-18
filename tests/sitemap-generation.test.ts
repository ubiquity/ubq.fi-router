import { expect, test, describe } from "bun:test"
import { createSitemapEntry, generateXmlSitemap, generateJsonSitemap } from "../src/sitemap-generator"
import { discoverAllServices, getCachedSitemapEntries } from "../src/sitemap-discovery"
import type { ServiceType } from "../src/types"

// Mock KV namespace for testing
const mockKV = {
  data: new Map<string, string>(),
  async get(key: string, options?: { type?: string }) {
    const value = this.data.get(key)
    if (!value) return null
    
    if (options?.type === 'json') {
      try {
        return JSON.parse(value)
      } catch {
        return null
      }
    }
    return value
  },
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.data.set(key, value)
  },
  async delete(key: string) {
    this.data.delete(key)
  },
  async list(options?: { prefix?: string }) {
    const keys = Array.from(this.data.keys())
      .filter(key => !options?.prefix || key.startsWith(options.prefix))
      .map(name => ({ name }))
    return { keys }
  }
}

describe("Sitemap Generation", () => {
  test("should create valid sitemap entry", () => {
    const entry = createSitemapEntry('pay', 'service-both')
    
    expect(entry.url).toBe('https://pay.ubq.fi/')
    expect(entry.serviceType).toBe('service-both')
    expect(entry.priority).toBe(0.9) // Core service
    expect(entry.changefreq).toBe('weekly')
    expect(entry.deployment.deno).toBe(true)
    expect(entry.deployment.pages).toBe(true)
    expect(entry.lastmod).toBeDefined()
  })

  test("should prioritize root domain correctly", () => {
    const rootEntry = createSitemapEntry('', 'service-pages')
    const serviceEntry = createSitemapEntry('pay', 'service-both')
    const pluginEntry = createSitemapEntry('os-command-config', 'plugin-deno')
    
    expect(rootEntry.priority).toBe(1.0)
    expect(serviceEntry.priority).toBe(0.9)  
    expect(pluginEntry.priority).toBe(0.6)
  })

  test("should include plugin manifest metadata", () => {
    const manifest = {
      name: "Command Config",
      description: "Plugin for command configuration",
      "ubiquity:listeners": ["issue.opened"]
    }
    
    const entry = createSitemapEntry('os-command-config', 'plugin-deno', manifest, 'ubiquity-os-marketplace/command-config')
    
    expect(entry.metadata?.pluginManifest).toEqual(manifest)
    expect(entry.metadata?.githubRepo).toBe('ubiquity-os-marketplace/command-config')
  })

  test("should generate valid XML sitemap", () => {
    const entries = [
      createSitemapEntry('', 'service-pages'),
      createSitemapEntry('pay', 'service-both'),
      createSitemapEntry('work', 'service-pages')
    ]
    
    const xml = generateXmlSitemap(entries)
    
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://ubq.fi/</loc>')
    expect(xml).toContain('<loc>https://pay.ubq.fi/</loc>')
    expect(xml).toContain('<loc>https://work.ubq.fi/</loc>')
    expect(xml).toContain('<priority>1.0</priority>')
    expect(xml).toContain('<changefreq>weekly</changefreq>')
    expect(xml).toContain('</urlset>')
  })

  test("should filter out non-existent services from XML", () => {
    const entries = [
      createSitemapEntry('existing', 'service-pages'),
      createSitemapEntry('missing', 'service-none')
    ]
    
    const xml = generateXmlSitemap(entries)
    
    expect(xml).toContain('https://existing.ubq.fi/')
    expect(xml).not.toContain('https://missing.ubq.fi/')
  })

  test("should generate valid JSON sitemap", () => {
    const entries = [
      createSitemapEntry('', 'service-pages'),
      createSitemapEntry('pay', 'service-both')
    ]
    
    const json = generateJsonSitemap(entries)
    
    expect(json.version).toBe('1.0')
    expect(json.generator).toBe('ubq.fi-router')
    expect(json.totalUrls).toBe(2)
    expect(json.generated).toBeDefined()
    expect(json.urls).toHaveLength(2)
    
    const rootEntry = json.urls.find(u => u.url === 'https://ubq.fi/')
    expect(rootEntry).toBeDefined()
    expect(rootEntry?.priority).toBe(1.0)
    expect(rootEntry?.deployment.pages).toBe(true)
  })

  test("should include all metadata in JSON sitemap", () => {
    const manifest = {
      name: "Test Plugin",
      description: "Test plugin description"
    }
    
    const entries = [
      createSitemapEntry('os-test-plugin', 'plugin-deno', manifest, 'ubiquity-os-marketplace/test-plugin')
    ]
    
    const json = generateJsonSitemap(entries)
    const pluginEntry = json.urls[0]
    
    expect(pluginEntry.metadata?.pluginManifest).toEqual(manifest)
    expect(pluginEntry.metadata?.githubRepo).toBe('ubiquity-os-marketplace/test-plugin')
  })

  test("should handle caching correctly", async () => {
    // Clear any existing cache
    mockKV.data.clear()
    
    // Mock getKnownServices and getKnownPlugins to return empty arrays for faster testing
    const originalFetch = global.fetch
    // @ts-ignore - Mocking fetch for testing
    global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = typeof url === 'string' ? url : url.toString()
      if (urlString.includes('api.github.com')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }
    
    try {
      // Use GitHub token for tests
      const githubToken = process.env.GITHUB_TOKEN
      if (!githubToken) {
        throw new Error('GITHUB_TOKEN environment variable is required for tests')
      }
      
      // First call should perform discovery
      const entries1 = await getCachedSitemapEntries(mockKV, false, githubToken)
      expect(Array.isArray(entries1)).toBe(true)
      
      // Cache should be populated
      expect(mockKV.data.has('sitemap:entries')).toBe(true)
      
      // Second call should use cache
      const entries2 = await getCachedSitemapEntries(mockKV, false, githubToken)
      expect(entries2).toEqual(entries1)
      
      // Force refresh should bypass cache
      const entries3 = await getCachedSitemapEntries(mockKV, true, githubToken)
      expect(Array.isArray(entries3)).toBe(true)
      
    } finally {
      global.fetch = originalFetch
    }
  }, 30000)

  test("should handle different service types correctly", () => {
    const testCases: Array<{ subdomain: string; serviceType: ServiceType; expectedDeployment: { deno: boolean; pages: boolean } }> = [
      { subdomain: 'deno-only', serviceType: 'service-deno', expectedDeployment: { deno: true, pages: false } },
      { subdomain: 'pages-only', serviceType: 'service-pages', expectedDeployment: { deno: false, pages: true } },
      { subdomain: 'both-services', serviceType: 'service-both', expectedDeployment: { deno: true, pages: true } },
      { subdomain: 'os-plugin-deno', serviceType: 'plugin-deno', expectedDeployment: { deno: true, pages: false } },
      { subdomain: 'os-plugin-pages', serviceType: 'plugin-pages', expectedDeployment: { deno: false, pages: true } },
      { subdomain: 'os-plugin-both', serviceType: 'plugin-both', expectedDeployment: { deno: true, pages: true } }
    ]
    
    testCases.forEach(({ subdomain, serviceType, expectedDeployment }) => {
      const entry = createSitemapEntry(subdomain, serviceType)
      expect(entry.deployment).toEqual(expectedDeployment)
    })
  })

  test("should handle priority calculation correctly", () => {
    const entries = [
      createSitemapEntry('regular', 'service-pages'),      // 0.8
      createSitemapEntry('', 'service-pages'),             // 1.0 (root)
      createSitemapEntry('pay', 'service-both'),           // 0.9 (core)
      createSitemapEntry('os-plugin', 'plugin-deno')       // 0.6
    ]
    
    const json = generateJsonSitemap(entries)
    
    // Check that each entry has correct priority
    const rootEntry = json.urls.find(u => u.url === 'https://ubq.fi/')
    const payEntry = json.urls.find(u => u.url === 'https://pay.ubq.fi/')
    const regularEntry = json.urls.find(u => u.url === 'https://regular.ubq.fi/')
    const pluginEntry = json.urls.find(u => u.url === 'https://os-plugin.ubq.fi/')
    
    expect(rootEntry?.priority).toBe(1.0)
    expect(payEntry?.priority).toBe(0.9)
    expect(regularEntry?.priority).toBe(0.8)
    expect(pluginEntry?.priority).toBe(0.6)
  })

  test("should validate XML structure", () => {
    const entries = [createSitemapEntry('test', 'service-pages')]
    const xml = generateXmlSitemap(entries)
    
    // Basic XML validation
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true)
    expect(xml.endsWith('</urlset>')).toBe(true)
    
    // Ensure proper URL structure
    expect(xml).toMatch(/<loc>https:\/\/test\.ubq\.fi\/<\/loc>/)
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/lastmod>/)
    expect(xml).toMatch(/<changefreq>weekly<\/changefreq>/)
    expect(xml).toMatch(/<priority>0\.8<\/priority>/)
  })
})
