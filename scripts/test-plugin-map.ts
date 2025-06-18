#!/usr/bin/env bun

import { getCachedPluginMapEntries } from '../src/plugin-map-discovery'
import { generateXmlPluginMap, generateJsonPluginMap } from '../src/plugin-map-generator'

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
  async list(options?: { prefix?: string }) {
    const keys = Array.from(this.data.keys()) as string[]
    const filteredKeys = options?.prefix
      ? keys.filter(k => k.startsWith(options.prefix!))
      : keys
    return { keys: filteredKeys.map(name => ({ name })) }
  },
  async delete(key: string) {
    this.data.delete(key)
  }
}

// Mock GitHub token - you should set this in your environment
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'your-github-token-here'

if (!GITHUB_TOKEN || GITHUB_TOKEN === 'your-github-token-here') {
  console.error('❌ Please set GITHUB_TOKEN environment variable')
  process.exit(1)
}

async function testPluginMapGeneration() {
  console.log('🧪 Testing Plugin-Map Generation...\n')

  try {
    // Test plugin discovery and entry generation
    console.log('🔍 Discovering plugins and generating entries...')
    const entries = await getCachedPluginMapEntries(mockKV, true, GITHUB_TOKEN)

    console.log(`📊 Plugin Discovery Results:`)
    console.log(`   Total entries: ${entries.length}`)

    // Count by service type
    const serviceTypeCounts = entries.reduce((acc, entry) => {
      acc[entry.serviceType] = (acc[entry.serviceType] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    console.log(`   Service type breakdown:`)
    Object.entries(serviceTypeCounts).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`)
    })

    // Filter valid entries (exclude plugin-none)
    const validEntries = entries.filter(entry => entry.serviceType !== 'plugin-none')
    console.log(`   Valid plugins: ${validEntries.length}`)

    if (validEntries.length > 0) {
      console.log('\n📝 Sample plugin entries:')
      validEntries.slice(0, 3).forEach(entry => {
        console.log(`   ${entry.pluginName}:`)
        console.log(`     URL: ${entry.url}`)
        console.log(`     Display Name: ${entry.displayName}`)
        console.log(`     Service Type: ${entry.serviceType}`)
        console.log(`     Main Available: ${entry.deployments.main.available}`)
        console.log(`     Dev Available: ${entry.deployments.development.available}`)
        if (entry.commands) {
          console.log(`     Commands: ${Object.keys(entry.commands).join(', ')}`)
        }
        if (entry.listeners) {
          console.log(`     Listeners: ${entry.listeners.join(', ')}`)
        }
        console.log()
      })
    }

    // Test XML generation
    console.log('🔧 Testing XML generation...')
    const xmlContent = generateXmlPluginMap(entries)
    console.log(`   XML length: ${xmlContent.length} characters`)
    console.log(`   Contains ${validEntries.length} valid URLs`)

    // Test JSON generation
    console.log('🔧 Testing JSON generation...')
    const jsonContent = generateJsonPluginMap(entries)
    console.log(`   JSON plugins count: ${jsonContent.totalPlugins}`)
    console.log(`   Generator: ${jsonContent.generator}`)
    console.log(`   Version: ${jsonContent.version}`)

    // Show XML sample
    console.log('\n📄 XML Sample (first 500 chars):')
    console.log(xmlContent.substring(0, 500) + '...')

    // Show JSON sample
    console.log('\n📄 JSON Sample (first plugin):')
    if (jsonContent.plugins.length > 0) {
      console.log(JSON.stringify(jsonContent.plugins[0], null, 2))
    }

    console.log('\n✅ Plugin-Map generation test completed successfully!')

    // Test caching
    console.log('\n🗄️  Testing caching...')
    const cachedEntries = await getCachedPluginMapEntries(mockKV, false, GITHUB_TOKEN)
    console.log(`   Cached entries: ${cachedEntries.length}`)
    console.log(`   Cache hit: ${cachedEntries.length === entries.length ? '✅' : '❌'}`)

  } catch (error) {
    console.error('❌ Plugin-Map generation test failed:', error)
    process.exit(1)
  }
}

// Run the test
testPluginMapGeneration()
