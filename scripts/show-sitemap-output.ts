#!/usr/bin/env bun

/**
 * Display complete sitemap outputs for review
 */

import { getCachedSitemapEntries } from '../src/sitemap-discovery'
import { generateXmlSitemap, generateJsonSitemap } from '../src/sitemap-generator'

// Mock KV namespace
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
      .filter((key) => !options?.prefix || (key as string).startsWith(options.prefix))
      .map((name) => ({ name: name as string }))
    return { keys }
  }
}

async function showSitemapOutputs() {
  console.log('🔍 Generating fresh sitemap data...\n')

  const entries = await getCachedSitemapEntries(mockKV, true)

  console.log('=' .repeat(80))
  console.log('📄 COMPLETE XML SITEMAP')
  console.log('=' .repeat(80))
  const xmlSitemap = generateXmlSitemap(entries)
  console.log(xmlSitemap)

  console.log('\n' + '=' .repeat(80))
  console.log('📊 COMPLETE JSON SITEMAP')
  console.log('=' .repeat(80))
  const jsonSitemap = generateJsonSitemap(entries)
  console.log(JSON.stringify(jsonSitemap, null, 2))

  console.log('\n' + '=' .repeat(80))
  console.log('📈 SUMMARY STATISTICS')
  console.log('=' .repeat(80))
  console.log(`Total entries generated: ${entries.length}`)
  console.log(`Valid entries in sitemap: ${jsonSitemap.totalUrls}`)
  console.log(`XML sitemap size: ${xmlSitemap.length} characters`)
  console.log(`JSON sitemap size: ${JSON.stringify(jsonSitemap).length} characters`)
  
  // Service type breakdown
  const serviceTypes = entries.reduce((acc, entry) => {
    acc[entry.serviceType] = (acc[entry.serviceType] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('\nService type breakdown:')
  Object.entries(serviceTypes)
    .sort(([,a], [,b]) => b - a)
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`)
    })
}

showSitemapOutputs().catch(console.error)
