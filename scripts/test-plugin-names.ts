#!/usr/bin/env bun

import { getPluginName } from './src/utils'

// Test cases for the new dynamic plugin name resolution
const testCases = [
  // Production alias
  { input: 'os-command-config.ubq.fi', expected: 'command-config-main' },

  // Standard branches
  { input: 'os-command-config-main.ubq.fi', expected: 'command-config-main' },
  { input: 'os-command-config-dev.ubq.fi', expected: 'command-config-dev' },

  // Dynamic branch names (should all work now)
  { input: 'os-command-config-mybranch.ubq.fi', expected: 'command-config-mybranch' },
  { input: 'os-command-config-pr-123.ubq.fi', expected: 'command-config-pr-123' },
  { input: 'os-command-config-issue-456.ubq.fi', expected: 'command-config-issue-456' },
  { input: 'os-command-config-feature-auth.ubq.fi', expected: 'command-config-feature-auth' },
  { input: 'os-command-config-fix-bug.ubq.fi', expected: 'command-config-fix-bug' },
  { input: 'os-command-config-any-branch-name.ubq.fi', expected: 'command-config-any-branch-name' },
  { input: 'os-permit-generation-hotfix-123.ubq.fi', expected: 'permit-generation-hotfix-123' },

  // Edge cases
  { input: 'os-single.ubq.fi', expected: 'single-main' },
  { input: 'os-multi-word-plugin.ubq.fi', expected: 'multi-word-plugin-main' },
  { input: 'os-multi-word-plugin-dev.ubq.fi', expected: 'multi-word-plugin-dev' },
]

console.log('Testing new dynamic plugin name resolution...\n')

let passed = 0
let failed = 0

for (const { input, expected } of testCases) {
  try {
    const actual = getPluginName(input)
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
