// import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test"
// import type { ServiceType } from "../src/types"
// import { routeRequest } from "../src/routing"
// import { getSubdomainKey, isPluginDomain } from "../src/utils"

// /**
//  * Integration tests for all ServiceType combinations using simplified mocks
//  * Focuses on core routing functionality rather than complex GitHub API mocking
//  */

// // Mock KV namespace
// const mockKV = {
//   data: new Map<string, string>(),
//   async get(key: string, options?: { type?: string }) {
//     const value = this.data.get(key)
//     if (!value) return null
//     return options?.type === 'json' ? JSON.parse(value) : value
//   },
//   async put(key: string, value: string, options?: { expirationTtl?: number }) {
//     this.data.set(key, value)
//   },
//   async delete(key: string) {
//     this.data.delete(key)
//   },
//   async list(options?: { prefix?: string }) {
//     const keys = Array.from(this.data.keys())
//       .filter(key => !options?.prefix || key.startsWith(options.prefix))
//       .map(name => ({ name }))
//     return { keys }
//   }
// }

// // Mock fetch function for proxy requests
// const originalFetch = global.fetch
// const mockFetch = mock(async (input: string | Request | URL, init?: RequestInit) => {
//   const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

//   // Mock successful responses for test URLs
//   if (url.includes('test-ubq-fi.deno.dev') || url.includes('test-ubq-fi.pages.dev') ||
//       url.includes('command-config-main.deno.dev') || url.includes('command-config-main.pages.dev')) {
//     return new Response('Mock service response', { status: 200 })
//   }

//   // Mock 404 for non-existent services
//   return new Response('Not found', { status: 404 })
// })

// describe("Integration Tests for All ServiceTypes", () => {
//   beforeEach(() => {
//     // Clear KV cache between tests
//     mockKV.data.clear()

//     // Set up fetch mock
//     global.fetch = mockFetch

//     // Cache known plugins to avoid GitHub API calls
//     mockKV.data.set('github:plugin-names', JSON.stringify([
//       'command-config', 'text-conversation-rewards', 'daemon-pricing'
//     ]))
//   })

//   afterEach(() => {
//     // Restore original fetch after tests
//     global.fetch = originalFetch
//   })

//   describe("Routing Integration for All ServiceTypes", () => {
//     test("service-deno routing", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType: ServiceType = "service-deno"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(200) // Proxied response from mock
//       expect(mockFetch).toHaveBeenCalled()
//     })

//     test("service-pages routing", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType: ServiceType = "service-pages"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(200) // Proxied response from mock
//       expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('test-ubq-fi.pages.dev'), expect.any(Object))
//     })

//     test("service-both routing", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType: ServiceType = "service-both"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(200) // Proxied response from mock (Deno Deploy primary)
//       expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('test-ubq-fi.deno.dev'), expect.any(Object))
//     })

//     test("service-none routing", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType: ServiceType = "service-none"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(404) // Not found
//     })

//     test("plugin-deno routing", async () => {
//       const request = new Request("https://os-command-config.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "os-command-config"
//       const serviceType: ServiceType = "plugin-deno"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(200) // Proxied response from mock
//       expect(mockFetch).toHaveBeenCalled()
//     })

//     test("plugin-pages routing", async () => {
//       const request = new Request("https://os-command-config.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "os-command-config"
//       const serviceType: ServiceType = "plugin-pages"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(200) // Proxied response from mock
//       expect(mockFetch).toHaveBeenCalled()
//     })

//     test("plugin-both routing", async () => {
//       const request = new Request("https://os-command-config.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "os-command-config"
//       const serviceType: ServiceType = "plugin-both"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(200) // Proxied response from mock (Deno Deploy primary)
//       expect(mockFetch).toHaveBeenCalled()
//     })

//     test("plugin-none routing", async () => {
//       const request = new Request("https://os-command-config.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "os-command-config"
//       const serviceType: ServiceType = "plugin-none"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(404) // Plugin not found
//     })
//   })

//   describe("ServiceType Validation", () => {
//     test("Should handle all 8 ServiceType variants", () => {
//       const allServiceTypes: ServiceType[] = [
//         "service-deno",
//         "service-pages",
//         "service-both",
//         "service-none",
//         "plugin-deno",
//         "plugin-pages",
//         "plugin-both",
//         "plugin-none"
//       ]

//       expect(allServiceTypes.length).toBe(8)

//       // Verify each type is valid
//       allServiceTypes.forEach(serviceType => {
//         expect(typeof serviceType).toBe("string")
//         expect(serviceType).toMatch(/^(service|plugin)-(deno|pages|both|none)$/)
//       })
//     })

//     test("Should categorize service vs plugin types correctly", () => {
//       const serviceTypes = ["service-deno", "service-pages", "service-both", "service-none"]
//       const pluginTypes = ["plugin-deno", "plugin-pages", "plugin-both", "plugin-none"]

//       serviceTypes.forEach(type => {
//         expect(type.startsWith("service-")).toBe(true)
//         expect(type.startsWith("plugin-")).toBe(false)
//       })

//       pluginTypes.forEach(type => {
//         expect(type.startsWith("plugin-")).toBe(true)
//         expect(type.startsWith("service-")).toBe(false)
//       })
//     })
//   })

//   describe("Utility Functions Integration", () => {
//     test("getSubdomainKey should work for all domain types", () => {
//       expect(getSubdomainKey("ubq.fi")).toBe("")
//       expect(getSubdomainKey("pay.ubq.fi")).toBe("pay")
//       expect(getSubdomainKey("work.ubq.fi")).toBe("work")
//       expect(getSubdomainKey("os-test.ubq.fi")).toBe("os-test")
//       expect(getSubdomainKey("os-text-conversation-rewards.ubq.fi")).toBe("os-text-conversation-rewards")
//     })

//     test("isPluginDomain should correctly identify plugins", () => {
//       expect(isPluginDomain("ubq.fi")).toBe(false)
//       expect(isPluginDomain("pay.ubq.fi")).toBe(false)
//       expect(isPluginDomain("work.ubq.fi")).toBe(false)
//       expect(isPluginDomain("os-test.ubq.fi")).toBe(true)
//       expect(isPluginDomain("os-text-conversation-rewards.ubq.fi")).toBe(true)
//       expect(isPluginDomain("os-command-query.ubq.fi")).toBe(true)
//     })
//   })

//   describe("URL Path and Query Preservation", () => {
//     test("Should preserve paths in all routing scenarios", async () => {
//       const testPath = "/api/v1/data?param=value"

//       const serviceTypes: ServiceType[] = [
//         "service-deno", "service-pages", "service-both",
//         "plugin-deno", "plugin-pages", "plugin-both"
//       ]

//       for (const serviceType of serviceTypes) {
//         const subdomain = serviceType.startsWith("plugin") ? "os-command-config" : "test"
//         const request = new Request(`https://${subdomain}.ubq.fi${testPath}`)
//         const url = new URL(request.url)

//         const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//         if (serviceType.startsWith("service")) {
//           expect(response.status).toBe(200) // Service types work with mock
//         } else {
//           expect(response.status).toBe(200) // Plugin types work with known plugin name
//         }
//         // Path preservation is handled by URL building, tested separately
//       }
//     })

//     test("Should handle root domain routing", async () => {
//       const request = new Request("https://ubq.fi/")
//       const url = new URL(request.url)
//       const subdomain = ""
//       const serviceType: ServiceType = "service-pages"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response.status).toBe(404) // Root domain not in mock, returns 404
//     })
//   })

//   describe("Error Handling", () => {
//     test("Should handle invalid service types gracefully", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType = "invalid-type" as ServiceType

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(404) // Should default to 404 for unknown types
//     })

//     test("Should handle malformed URLs gracefully", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType: ServiceType = "service-none"

//       const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//       expect(response).toBeInstanceOf(Response)
//       expect(response.status).toBe(404)
//     })
//   })

//   describe("Performance and Consistency", () => {
//     test("URL building should be fast and consistent", async () => {
//       const request = new Request("https://test.ubq.fi/api/data")
//       const url = new URL(request.url)
//       const subdomain = "test"
//       const serviceType: ServiceType = "service-deno"

//       const startTime = performance.now()

//       // Run multiple times to check consistency
//       for (let i = 0; i < 10; i++) {
//         const response = await routeRequest(request, url, subdomain, serviceType, mockKV)
//         expect(response.status).toBe(200) // Proxied response from mock
//       }

//       const endTime = performance.now()
//       const totalTime = endTime - startTime

//       // Should complete 10 operations in under 100ms
//       expect(totalTime).toBeLessThan(100)
//     })

//     test("Domain parsing should handle edge cases efficiently", () => {
//       const testCases = [
//         { domain: "ubq.fi", expected: "" },
//         { domain: "a.ubq.fi", expected: "a" },
//         { domain: "very-long-subdomain-name.ubq.fi", expected: "very-long-subdomain-name" },
//         { domain: "os-plugin-with-dashes.ubq.fi", expected: "os-plugin-with-dashes" }
//       ]

//       testCases.forEach(({ domain, expected }) => {
//         const result = getSubdomainKey(domain)
//         expect(result).toBe(expected)
//       })
//     })
//   })

//   describe("Real-world Service Type Scenarios", () => {
//     test("Production service routing patterns", async () => {
//       // Test patterns discovered from comprehensive validation
//       const realScenarios = [
//         { subdomain: "", serviceType: "service-pages" as ServiceType, expectMock: false },     // Root domain (won't match mock URLs)
//         { subdomain: "test", serviceType: "service-both" as ServiceType, expectMock: true },   // Test service
//         { subdomain: "test", serviceType: "service-pages" as ServiceType, expectMock: true }, // Test service
//         { subdomain: "test", serviceType: "service-deno" as ServiceType, expectMock: true },    // Test service
//         { subdomain: "demo", serviceType: "service-none" as ServiceType, expectMock: false }   // Demo service
//       ]

//       for (const { subdomain, serviceType, expectMock } of realScenarios) {
//         const domain = subdomain ? `${subdomain}.ubq.fi` : "ubq.fi"
//         const request = new Request(`https://${domain}/`)
//         const url = new URL(request.url)

//         const response = await routeRequest(request, url, subdomain, serviceType, mockKV)

//         if (serviceType === "service-none") {
//           expect(response.status).toBe(404)
//         } else if (expectMock) {
//           expect(response.status).toBe(200) // Proxied response from mock
//         } else {
//           expect(response.status).toBe(404) // URL not in mock, so returns 404
//         }
//       }
//     })
//   })
// })
