import { describe, test, expect } from 'bun:test'
import { handleHealthApi } from '../src/health-dashboard/api'

// Mock KV namespace for testing
const mockKV = {
  get: async (key: string) => {
    if (key === 'health:latest') {
      return null // No cached data for initial test
    }
    return null
  },
  put: async (key: string, value: string, options?: any) => {
    // Mock successful cache put
    return
  },
  list: async (options?: any) => ({
    keys: []
  }),
  delete: async (key: string) => {
    return
  }
}

// Mock environment
const mockEnv = {
  ROUTER_CACHE: mockKV as any,
  GITHUB_TOKEN: 'test-token'
}

describe('Health Dashboard API', () => {
  test('should return health data structure', async () => {
    const request = new Request('https://health.ubq.fi/json')
    
    const response = await handleHealthApi(request, mockEnv)
    
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    
    const data = await response.json() as any
    
    // Verify response structure
    expect(data).toHaveProperty('lastUpdated')
    expect(data).toHaveProperty('services')
    expect(data).toHaveProperty('plugins')
    expect(data).toHaveProperty('summary')
    
    // Verify summary structure
    expect(data.summary).toHaveProperty('totalServices')
    expect(data.summary).toHaveProperty('healthyServices')
    expect(data.summary).toHaveProperty('totalPlugins')
    expect(data.summary).toHaveProperty('healthyPlugins')
    expect(data.summary).toHaveProperty('overallHealthPercentage')
    
    // Verify we have actual data
    expect(data.services).toBeDefined()
    expect(data.plugins).toBeDefined()
    expect(Array.isArray(data.services)).toBe(true)
    expect(Array.isArray(data.plugins)).toBe(true)
    
    console.log('✅ Health API returned data for:')
    console.log(`   📊 Services: ${data.summary.totalServices} total, ${data.summary.healthyServices} healthy`)
    console.log(`   📊 Plugins: ${data.summary.totalPlugins} total, ${data.summary.healthyPlugins} healthy`)
    console.log(`   📊 Overall Health: ${data.summary.overallHealthPercentage}%`)
  }, 30000) // 30 second timeout for real API calls
})
