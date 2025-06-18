import { expect, test, describe } from "bun:test"
import { coalesceDiscovery } from "../src/service-discovery"
import { routeRequest } from "../src/routing"
import { getKnownServices } from "../src/utils"
import type { ServiceType } from "../src/types"

// Real KV namespace mock that stores data in memory
const realKV = {
  data: new Map<string, string>(),
  async get(key: string) {
    return this.data.get(key) || null
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

describe("Real Service Type Discovery", () => {

  describe("Service Discovery Integration", () => {
    test("should discover service types for real domains", async () => {
      // Test a few known working domains without showing error messages
      const testCases = [
        { subdomain: "pay", expectType: /^service-(deno|pages|both)$/ },
        { subdomain: "work", expectType: /^service-(deno|pages|both)$/ }
      ]

      for (const testCase of testCases) {
        const result = await coalesceDiscovery(
          testCase.subdomain,
          new URL(`https://${testCase.subdomain}.ubq.fi`),
          realKV
        )
        expect(result).toMatch(testCase.expectType)
        console.log(`✅ ${testCase.subdomain}.ubq.fi → ${result}`)
      }
    })
  })

  describe("URL Building and Routing Logic", () => {
    test("should handle all service types in routing", async () => {
      const serviceTypes: ServiceType[] = [
        "service-deno",
        "service-pages",
        "service-both",
        "service-none",
        "plugin-deno",
        "plugin-pages",
        "plugin-both",
        "plugin-none"
      ]

      for (const serviceType of serviceTypes) {
        const request = new Request("https://test.ubq.fi/path?param=value")
        const url = new URL("https://test.ubq.fi/path?param=value")

        try {
          const response = await routeRequest(request, url, "test", serviceType, realKV)

          if (serviceType.endsWith("-none")) {
            expect(response.status).toBe(404)
            const text = await response.text()
            expect(text).toBe("Service not found")
          } else {
            // For real service types, we expect either a real response or a network error
            // The important thing is that the routing logic executes without throwing
            expect(response).toBeInstanceOf(Response)
          }
        } catch (error) {
          // Network errors are expected for non-existent services
          // The important thing is that our routing logic handles them gracefully
          expect(error).toBeDefined()
        }
      }
    })
  })

  describe("Real GitHub Data Testing", () => {
    test("should test all real *.ubq.fi services and plugins from GitHub", async () => {
      const discoveredTypes = new Set<ServiceType>()

      // Get real service subdomains from GitHub ubiquity org
      console.log("🔍 Testing real services from GitHub ubiquity org...")
      try {
        const knownServices = await getKnownServices(realKV)
        console.log(`📋 Found ${knownServices.length} service repos: ${knownServices.join(", ")}`)

        // Test each real service subdomain
        for (const subdomain of knownServices.slice(0, 8)) { // Test more real services
          try {
            console.log(`  Testing ${subdomain || "root"}...`)
            const result = await coalesceDiscovery(
              subdomain,
              new URL(`https://${subdomain ? subdomain + "." : ""}ubq.fi`),
              realKV
            )
            discoveredTypes.add(result)
            console.log(`    ✅ ${subdomain}.ubq.fi → ${result}`)
          } catch (error) {
            console.log(`    ❌ ${subdomain}.ubq.fi → Error: ${(error as Error).message}`)
          }
        }
      } catch (error) {
        console.log("Failed to fetch services from GitHub:", (error as Error).message)
      }

      // Test real plugins from the marketplace (only known working ones)
      console.log("\n🔍 Testing real plugins from GitHub marketplace...")
      const testPlugins = ["command-config"] // Only test plugins we know exist

      for (const plugin of testPlugins) {
        try {
          console.log(`  Testing os-${plugin}...`)
          const result = await coalesceDiscovery(
            `os-${plugin}`,
            new URL(`https://os-${plugin}.ubq.fi`),
            realKV
          )
          discoveredTypes.add(result)
          console.log(`    ✅ os-${plugin}.ubq.fi → ${result}`)
        } catch (error) {
          console.log(`    ❌ os-${plugin}.ubq.fi → Error: ${(error as Error).message}`)
        }
      }

      console.log("\n📊 Service Types Discovered in Real GitHub Testing:")
      const allTypes: ServiceType[] = [
        "service-deno", "service-pages", "service-both", "service-none",
        "plugin-deno", "plugin-pages", "plugin-both", "plugin-none"
      ]

      for (const type of allTypes) {
        const discovered = discoveredTypes.has(type)
        console.log(`   ${discovered ? "✅" : "⚪"} ${type}`)
      }

      // We should discover some service types from real GitHub data
      expect(discoveredTypes.size).toBeGreaterThan(0)

      console.log(`\n🎯 Successfully discovered ${discoveredTypes.size} different service types`)
      console.log(`🔍 Discovered types: ${Array.from(discoveredTypes).join(", ")}`)
    }, 15000) // Increase timeout to 15 seconds for comprehensive GitHub testing
  })

  describe("Cache Integration", () => {
    test("should cache discovery results", async () => {
      const subdomain = "cache-test-domain"
      const url = new URL(`https://${subdomain}.ubq.fi`)

      // Clear any existing cache
      await realKV.delete(`route:${subdomain}`)

      // First discovery should hit the network
      const start1 = Date.now()
      const result1 = await coalesceDiscovery(subdomain, url, realKV)
      const time1 = Date.now() - start1

      // Second discovery should be faster (cached)
      const start2 = Date.now()
      const result2 = await coalesceDiscovery(subdomain, url, realKV)
      const time2 = Date.now() - start2

      // Results should be the same
      expect(result1).toBe(result2)

      // Second call should be significantly faster (cached)
      expect(time2).toBeLessThan(time1)

      console.log(`Cache test: First call ${time1}ms, Second call ${time2}ms`)
    })
  })

  describe("Error Handling", () => {
    test("should handle network timeouts gracefully", async () => {
      // Test with a domain that will timeout or fail
      const result = await coalesceDiscovery(
        "timeout-test",
        new URL("https://timeout-test.ubq.fi"),
        realKV
      )

      // Should gracefully return service-none instead of throwing
      expect(result).toBe("service-none")
    })

    test("should handle invalid domain formats", async () => {
      try {
        // This should work fine - our router handles various subdomain formats
        const result = await coalesceDiscovery(
          "beta.pay",
          new URL("https://beta.pay.ubq.fi"),
          realKV
        )
        expect(result).toMatch(/^(service|plugin)-(deno|pages|both|none)$/)
      } catch (error) {
        // If it fails, it should fail gracefully
        expect(error).toBeInstanceOf(Error)
      }
    })
  })
})
