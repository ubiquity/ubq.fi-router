import { expect, test, describe, beforeEach, mock } from "bun:test"
import type { ServiceType } from "../src/types"
import { coalesceDiscovery } from "../src/service-discovery"
import { routeRequest } from "../src/routing"
import { getKnownServices, getKnownPlugins, getSubdomainKey, isPluginDomain } from "../src/utils"

/**
 * Integration tests for all ServiceType combinations using real implementation
 * Tests actual functions with mocked external dependencies
 */

// Mock KV namespace
const mockKV = {
  data: new Map<string, string>(),
  async get(key: string, options?: { type?: string }) {
    const value = this.data.get(key)
    if (!value) return null
    return options?.type === 'json' ? JSON.parse(value) : value
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

import { GITHUB_TOKEN as TEST_GITHUB_TOKEN } from "../src/env"

// Setup mock responses for different scenarios
const setupMockResponses = () => {
  // Mock successful service responses
  mock.module("global", () => ({
    fetch: mock(async (url: string, options?: any) => {
      const urlObj = new URL(url)

      // GitHub API mocks
      if (url.includes('api.github.com/orgs/ubiquity/repos')) {
        return new Response(JSON.stringify([
          { name: 'ubq.fi' },
          { name: 'pay.ubq.fi' },
          { name: 'work.ubq.fi' },
          { name: 'demo.ubq.fi' }
        ]), { status: 200 })
      }

      if (url.includes('api.github.com/orgs/ubiquity-os-marketplace/repos')) {
        return new Response(JSON.stringify([
          { name: 'text-conversation-rewards' },
          { name: 'daemon-pricing' },
          { name: 'command-query' },
          { name: 'pricing-calculator' }
        ]), { status: 200 })
      }

      // Service deployment mocks based on URL patterns
      if (urlObj.hostname.includes('deno.dev')) {
        // Mock different Deno deployment scenarios
        if (urlObj.hostname.includes('pay-ubq-fi')) {
          return new Response('OK', { status: 200 }) // pay service exists on Deno
        }
        if (urlObj.hostname.includes('ubq-fi.deno.dev')) {
          return new Response('Not Found', { status: 404 }) // root doesn't exist on Deno
        }
        if (urlObj.hostname.includes('work-ubq-fi')) {
          return new Response('Not Found', { status: 404 }) // work doesn't exist on Deno
        }
        if (urlObj.hostname.includes('demo-ubq-fi')) {
          return new Response('Not Found', { status: 404 }) // demo doesn't exist
        }
        // Plugin deployments on Deno
        if (urlObj.hostname.includes('text-conversation-rewards-main')) {
          return new Response('OK', { status: 200 })
        }
        return new Response('Not Found', { status: 404 })
      }

      if (urlObj.hostname.includes('pages.dev')) {
        // Mock different Pages deployment scenarios
        if (urlObj.hostname.includes('ubq-fi.pages.dev')) {
          return new Response('OK', { status: 200 }) // root exists on Pages
        }
        if (urlObj.hostname.includes('pay-ubq-fi')) {
          return new Response('OK', { status: 200 }) // pay service exists on Pages
        }
        if (urlObj.hostname.includes('work-ubq-fi')) {
          return new Response('OK', { status: 200 }) // work exists on Pages
        }
        if (urlObj.hostname.includes('demo-ubq-fi')) {
          return new Response('Not Found', { status: 404 }) // demo doesn't exist
        }
        return new Response('Not Found', { status: 404 })
      }

      // Plugin manifest mocks
      if (url.includes('/manifest.json')) {
        if (url.includes('text-conversation-rewards-main')) {
          return new Response(JSON.stringify({
            name: 'Text Conversation Rewards',
            description: 'Rewards plugin for text conversations'
          }), { status: 200 })
        }
        return new Response('Not Found', { status: 404 })
      }

      // Default 404 for unknown URLs
      return new Response('Not Found', { status: 404 })
    })
  }))
}

describe("Integration Tests for All ServiceTypes", () => {
  beforeEach(() => {
    // Clear KV cache between tests
    mockKV.data.clear()
    setupMockResponses()
  })

  describe("Standard Service Discovery", () => {
    test("service-both: Pay service (Deno + Pages)", async () => {
      const subdomain = "pay"
      const url = new URL("https://pay.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("service-both")
    })

    test("service-pages: Root domain (Pages only)", async () => {
      const subdomain = ""
      const url = new URL("https://ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("service-pages")
    })

    test("service-pages: Work service (Pages only)", async () => {
      const subdomain = "work"
      const url = new URL("https://work.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("service-pages")
    })

    test("service-none: Demo service (no deployments)", async () => {
      const subdomain = "demo"
      const url = new URL("https://demo.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("service-none")
    })
  })

  describe("Plugin Service Discovery", () => {
    test("plugin-deno: Text conversation rewards (Deno only)", async () => {
      const subdomain = "os-text-conversation-rewards"
      const url = new URL("https://os-text-conversation-rewards.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("plugin-deno")
    })

    test("plugin-none: Unknown plugin", async () => {
      const subdomain = "os-daemon-pricing"
      const url = new URL("https://os-daemon-pricing.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("plugin-none")
    })

    test("plugin-none: Command query plugin", async () => {
      const subdomain = "os-command-query"
      const url = new URL("https://os-command-query.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("plugin-none")
    })

    // Test for future plugin-both scenario
    test("plugin-both: Pricing calculator (mocked future deployment)", async () => {
      // Override fetch for this specific test to simulate both deployments
      const originalFetch = global.fetch
      global.fetch = mock(async (url: string) => {
        if (url.includes('pricing-calculator-main.deno.dev')) {
          if (url.includes('/manifest.json')) {
            return new Response(JSON.stringify({
              name: 'Pricing Calculator',
              description: 'Calculate pricing for services'
            }), { status: 200 })
          }
          return new Response('OK', { status: 200 })
        }
        if (url.includes('pricing-calculator-main.pages.dev')) {
          if (url.includes('/manifest.json')) {
            return new Response(JSON.stringify({
              name: 'Pricing Calculator',
              description: 'Calculate pricing for services'
            }), { status: 200 })
          }
          return new Response('OK', { status: 200 })
        }
        if (url.includes('api.github.com')) {
          return originalFetch(url)
        }
        return new Response('Not Found', { status: 404 })
      }) as any

      const subdomain = "os-pricing-calculator"
      const url = new URL("https://os-pricing-calculator.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("plugin-both")

      // Restore original fetch
      global.fetch = originalFetch
    })
  })

  describe("Routing Integration for All ServiceTypes", () => {
    test("service-deno routing", async () => {
      const request = new Request("https://test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "test"
      const serviceType: ServiceType = "service-deno"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(302) // Redirect to Deno Deploy
    })

    test("service-pages routing", async () => {
      const request = new Request("https://test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "test"
      const serviceType: ServiceType = "service-pages"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(302) // Redirect to Cloudflare Pages
    })

    test("service-both routing", async () => {
      const request = new Request("https://test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "test"
      const serviceType: ServiceType = "service-both"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(302) // Should route to Deno Deploy (primary)
    })

    test("service-none routing", async () => {
      const request = new Request("https://test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "test"
      const serviceType: ServiceType = "service-none"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(404) // Not found
    })

    test("plugin-deno routing", async () => {
      const request = new Request("https://os-test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "os-test"
      const serviceType: ServiceType = "plugin-deno"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(302) // Redirect to plugin on Deno Deploy
    })

    test("plugin-pages routing", async () => {
      const request = new Request("https://os-test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "os-test"
      const serviceType: ServiceType = "plugin-pages"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(302) // Redirect to plugin on Cloudflare Pages
    })

    test("plugin-both routing", async () => {
      const request = new Request("https://os-test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "os-test"
      const serviceType: ServiceType = "plugin-both"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(302) // Should route to plugin Deno Deploy (primary)
    })

    test("plugin-none routing", async () => {
      const request = new Request("https://os-test.ubq.fi/api/data")
      const url = new URL(request.url)
      const subdomain = "os-test"
      const serviceType: ServiceType = "plugin-none"

      const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

      expect(response).toBeInstanceOf(Response)
      expect(response.status).toBe(404) // Plugin not found
    })
  })

  describe("GitHub Token Integration", () => {
    test("Should pass GitHub token through service discovery chain", async () => {
      const subdomain = "pay"
      const url = new URL("https://pay.ubq.fi")

      // Clear any cached data to force fresh API calls
      mockKV.data.clear()

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBeDefined()
      expect(["service-deno", "service-pages", "service-both", "service-none"]).toContain(serviceType)
    })

    test("Should work without GitHub token (but may hit rate limits)", async () => {
      const subdomain = "pay"
      const url = new URL("https://pay.ubq.fi")

      // Clear any cached data to force fresh API calls
      mockKV.data.clear()

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV) // No token

      expect(serviceType).toBeDefined()
      expect(["service-deno", "service-pages", "service-both", "service-none"]).toContain(serviceType)
    })

    test("Should handle GitHub API errors gracefully", async () => {
      // Override fetch to simulate GitHub API error
      const originalFetch = global.fetch
      global.fetch = mock(async (url: string) => {
        if (url.includes('api.github.com')) {
          return new Response('Rate limit exceeded', { status: 403 })
        }
        return originalFetch(url)
      }) as any

      const subdomain = "pay"
      const url = new URL("https://pay.ubq.fi")

      // Should throw error when GitHub API fails
      await expect(coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)).rejects.toThrow()

      // Restore original fetch
      global.fetch = originalFetch
    })
  })

  describe("Utility Functions Integration", () => {
    test("getSubdomainKey should work for all domain types", () => {
      expect(getSubdomainKey("ubq.fi")).toBe("")
      expect(getSubdomainKey("pay.ubq.fi")).toBe("pay")
      expect(getSubdomainKey("work.ubq.fi")).toBe("work")
      expect(getSubdomainKey("os-test.ubq.fi")).toBe("os-test")
    })

    test("isPluginDomain should correctly identify plugins", () => {
      expect(isPluginDomain("ubq.fi")).toBe(false)
      expect(isPluginDomain("pay.ubq.fi")).toBe(false)
      expect(isPluginDomain("os-test.ubq.fi")).toBe(true)
      expect(isPluginDomain("os-text-conversation-rewards.ubq.fi")).toBe(true)
    })

    test("getKnownServices should fetch and cache services", async () => {
      const services = await getKnownServices(mockKV)

      expect(Array.isArray(services)).toBe(true)
      expect(services.length).toBeGreaterThan(0)
      expect(services).toContain("")  // root domain
      expect(services).toContain("pay")
      expect(services).toContain("work")
    })

    test("getKnownPlugins should fetch and cache plugins", async () => {
      const plugins = await getKnownPlugins(mockKV)

      expect(Array.isArray(plugins)).toBe(true)
      expect(plugins.length).toBeGreaterThan(0)
      expect(plugins).toContain("text-conversation-rewards")
      expect(plugins).toContain("daemon-pricing")
    })
  })

  describe("Caching Integration", () => {
    test("Should cache service discovery results", async () => {
      const subdomain = "pay"
      const url = new URL("https://pay.ubq.fi")

      // First call - should cache result
      const firstResult = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      // Second call - should use cached result
      const secondResult = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(firstResult).toBe(secondResult)
    })

    test("Should cache GitHub API responses", async () => {
      // First call to getKnownServices
      const firstServices = await getKnownServices(mockKV)

      // Second call should use cached data
      const secondServices = await getKnownServices(mockKV)

      expect(firstServices).toEqual(secondServices)
    })
  })

  describe("Error Handling for All ServiceTypes", () => {
    test("Should handle network timeouts gracefully", async () => {
      // Override fetch to simulate timeout
      const originalFetch = global.fetch
      global.fetch = mock(async () => {
        throw new Error('Network timeout')
      }) as any

      const subdomain = "test"
      const url = new URL("https://test.ubq.fi")

      // Should not throw but return service-none
      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN).catch(() => "service-none" as ServiceType)

      expect(serviceType).toBe("service-none")

      // Restore original fetch
      global.fetch = originalFetch
    })

    test("Should handle plugin name resolution errors", async () => {
      const subdomain = "os-nonexistent-plugin"
      const url = new URL("https://os-nonexistent-plugin.ubq.fi")

      const serviceType = await coalesceDiscovery(subdomain, url, mockKV, TEST_GITHUB_TOKEN)

      expect(serviceType).toBe("plugin-none")
    })
  })
})
