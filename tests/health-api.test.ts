import { describe, test, expect } from 'bun:test'
import { handleHealthApi } from '../src/health-dashboard/api'

// Simple mock environment
const mockEnv = {
  ROUTER_CACHE: {
    get: async () => JSON.stringify({
      services: {'service1': {healthy: true}},
      plugins: {'plugin1': {healthy: true}},
      lastGlobalUpdate: new Date().toISOString()
    }),
    put: async () => {}
  },
  GITHUB_TOKEN: 'test-token'
} as any

describe('Health Dashboard API', () => {
  test('should return health summary for /json', async () => {
    const request = new Request('https://health.ubq.fi/json')
    const response = await handleHealthApi(request, mockEnv)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('summary')
  })

  test('should return services list for /health/services', async () => {
    const request = new Request('https://health.ubq.fi/health/services')
    const response = await handleHealthApi(request, mockEnv)
    expect(response.status).toBe(200)
    const data = await response.json() as any
    expect(data.services).toBeArray()
  })

  test('should accept health updates via POST /health/update', async () => {
    const request = new Request('https://health.ubq.fi/health/update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        type: 'service',
        key: 'new-service',
        result: {healthy: true}
      })
    })
    const response = await handleHealthApi(request, mockEnv)
    expect(response.status).toBe(200)
  })

  test('should return 404 for unknown paths', async () => {
    const request = new Request('https://health.ubq.fi/unknown')
    const response = await handleHealthApi(request, mockEnv)
    expect(response.status).toBe(404)
  })

  test('should handle errors', async () => {
    const errorEnv = {
      ...mockEnv,
      ROUTER_CACHE: {
        get: async () => { throw new Error('Test error') }
      }
    }
    const request = new Request('https://health.ubq.fi/health/services')
    const response = await handleHealthApi(request, errorEnv)
    expect(response.status).toBe(500)
  })
})
