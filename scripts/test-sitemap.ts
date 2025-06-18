#!/usr/bin/env bun

/**
 * Test script for sitemap generation functionality
 * Demonstrates both XML and JSON sitemap generation
 */

import { getCachedSitemapEntries } from '../src/sitemap-discovery'
import { generateXmlSitemap, generateJsonSitemap } from '../src/sitemap-generator'

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
    console.log(`💾 Cached ${key}`)
  },
  async delete(key: string) {
    this.data.delete(key)
  },
  async list(options?: { prefix?: string }) {
    const keys = Array.from(this.data.keys())
      .filter((key) => !options?.prefix || (key as string).startsWith(options.prefix))
      .map((name) => ({ name: name as string }))
    return { keys }
  }
}

async function testSitemapGeneration() {
  console.log('🚀 Testing sitemap generation...\n')

  try {
    // Generate sitemap entries
    console.log('📍 Discovering services and generating sitemap entries...')
    const entries = await getCachedSitemapEntries(mockKV, true) // Force refresh
    
    console.log(`✅ Generated ${entries.length} sitemap entries\n`)

    // Show some example entries
    console.log('📋 Sample entries:')
    entries.slice(0, 5).forEach(entry => {
      console.log(`  • ${entry.url} (${entry.serviceType}, priority: ${entry.priority})`)
    })
    console.log()

    // Generate XML sitemap
    console.log('🔧 Generating XML sitemap...')
    const xmlSitemap = generateXmlSitemap(entries)
    console.log(`📄 XML sitemap generated (${xmlSitemap.length} characters)`)
    
    // Show first few lines of XML
    const xmlLines = xmlSitemap.split('\n').slice(0, 10)
    console.log('📝 XML preview:')
    xmlLines.forEach(line => console.log(`  ${line}`))
    console.log('  ...\n')

    // Generate JSON sitemap
    console.log('🔧 Generating JSON sitemap...')
    const jsonSitemap = generateJsonSitemap(entries)
    console.log(`📊 JSON sitemap generated (${jsonSitemap.totalUrls} URLs)`)
    
    // Show JSON structure
    console.log('📝 JSON preview:')
    console.log(`  Version: ${jsonSitemap.version}`)
    console.log(`  Generator: ${jsonSitemap.generator}`)
    console.log(`  Generated: ${jsonSitemap.generated}`)
    console.log(`  Total URLs: ${jsonSitemap.totalUrls}`)
    console.log(`  Sample URL:`, JSON.stringify(jsonSitemap.urls[0], null, 2))

    console.log('\n✅ Sitemap generation test completed successfully!')

    // Test caching
    console.log('\n🔄 Testing cache functionality...')
    const cachedEntries = await getCachedSitemapEntries(mockKV, false) // Use cache
    console.log(`📦 Retrieved ${cachedEntries.length} entries from cache`)
    
    console.log('\n🎉 All tests completed successfully!')

  } catch (error) {
    console.error('❌ Error during sitemap generation:', error)
    process.exit(1)
  }
}

// Run the test
testSitemapGeneration()
