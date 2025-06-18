#!/usr/bin/env bun

import { getPluginName } from '../src/utils'

// Mock KV namespace for testing
const mockKV = {
  data: new Map<string, string>(),
  async get(key: string) {
    return this.data.get(key) || null
  },
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.data.set(key, value)
  }
}

// Test cases for the new dynamic plugin name resolution
// Only testing with known real plugins from GitHub
const testCases = [
  // Production alias - these use real plugins that exist
  { input: 'os-command-config.ubq.fi', expected: 'command-config-main' },

  // Standard branches with real plugins
  { input: 'os-command-config-main.ubq.fi', expected: 'command-config-main' },
  { input: 'os-command-config-dev.ubq.fi', expected: 'command-config-dev' },

  // Dynamic branch names with real plugins (these should work with real plugin base)
  { input: 'os-command-config-mybranch.ubq.fi', expected: 'command-config-mybranch' },
  { input: 'os-command-config-pr-123.ubq.fi', expected: 'command-config-pr-123' },
  { input: 'os-command-config-issue-456.ubq.fi', expected: 'command-config-issue-456' },
  { input: 'os-command-config-feature-auth.ubq.fi', expected: 'command-config-feature-auth' },
  { input: 'os-command-config-fix-bug.ubq.fi', expected: 'command-config-fix-bug' },
  { input: 'os-command-config-any-branch-name.ubq.fi', expected: 'command-config-any-branch-name' },
]

console.log('Testing new dynamic plugin name resolution...\n')

let passed = 0
let failed = 0

for (const { input, expected } of testCases) {
  try {
    const actual = await getPluginName(input, mockKV)
    if (actual === expected) {
      console.log(`✅ ${input} → ${actual}`)
      passed++
    } else {
      console.log(`❌ ${input} → ${actual} (expected: ${expected})`)
      failed++
    }
  } catch (error) {
    console.log(`❌ ${input} → ERROR: ${error.message}`)
    failed++
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`)

if (failed === 0) {
  console.log('🎉 All tests passed! Dynamic plugin routing is working correctly.')
} else {
  console.log('⚠️  Some tests failed. Please check the implementation.')
  process.exit(1)
}
