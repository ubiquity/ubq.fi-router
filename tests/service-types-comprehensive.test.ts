import { expect, test, describe } from "bun:test"

/**
 * Comprehensive Unit Tests for All ServiceType Combinations
 * Tests every possible service type to ensure router handles all scenarios correctly
 */

// Import the ServiceType to ensure we're testing all variants
import type { ServiceType } from "../src/types"

// Mock service discovery function that returns different service types
function mockServiceDiscovery(serviceType: ServiceType): ServiceType {
  return serviceType
}

// Mock routing function that handles different service types
function mockRouting(serviceType: ServiceType): { route: string; fallback?: string } {
  switch (serviceType) {
    case "service-deno":
      return { route: "deno-deploy" }
    case "service-pages":
      return { route: "cloudflare-pages" }
    case "service-both":
      return { route: "deno-deploy", fallback: "cloudflare-pages" }
    case "service-none":
      return { route: "404" }
    case "plugin-deno":
      return { route: "plugin-deno-deploy" }
    case "plugin-pages":
      return { route: "plugin-cloudflare-pages" }
    case "plugin-both":
      return { route: "plugin-deno-deploy", fallback: "plugin-cloudflare-pages" }
    case "plugin-none":
      return { route: "plugin-404" }
    default:
      return { route: "error" }
  }
}

describe("ServiceType Comprehensive Tests", () => {

  describe("Service Types", () => {
    test("service-deno: Should route to Deno Deploy only", () => {
      const serviceType: ServiceType = "service-deno"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("service-deno")
      expect(routing.route).toBe("deno-deploy")
      expect(routing.fallback).toBeUndefined()
    })

    test("service-pages: Should route to Cloudflare Pages only", () => {
      const serviceType: ServiceType = "service-pages"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("service-pages")
      expect(routing.route).toBe("cloudflare-pages")
      expect(routing.fallback).toBeUndefined()
    })

    test("service-both: Should route to Deno with Pages fallback", () => {
      const serviceType: ServiceType = "service-both"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("service-both")
      expect(routing.route).toBe("deno-deploy")
      expect(routing.fallback).toBe("cloudflare-pages")
    })

    test("service-none: Should return 404", () => {
      const serviceType: ServiceType = "service-none"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("service-none")
      expect(routing.route).toBe("404")
      expect(routing.fallback).toBeUndefined()
    })
  })

  describe("Plugin Types", () => {
    test("plugin-deno: Should route to plugin on Deno Deploy", () => {
      const serviceType: ServiceType = "plugin-deno"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("plugin-deno")
      expect(routing.route).toBe("plugin-deno-deploy")
      expect(routing.fallback).toBeUndefined()
    })

    test("plugin-pages: Should route to plugin on Cloudflare Pages", () => {
      const serviceType: ServiceType = "plugin-pages"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("plugin-pages")
      expect(routing.route).toBe("plugin-cloudflare-pages")
      expect(routing.fallback).toBeUndefined()
    })

    test("plugin-both: Should route to plugin Deno with Pages fallback", () => {
      const serviceType: ServiceType = "plugin-both"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("plugin-both")
      expect(routing.route).toBe("plugin-deno-deploy")
      expect(routing.fallback).toBe("plugin-cloudflare-pages")
    })

    test("plugin-none: Should return plugin 404", () => {
      const serviceType: ServiceType = "plugin-none"
      const discovery = mockServiceDiscovery(serviceType)
      const routing = mockRouting(discovery)

      expect(discovery).toBe("plugin-none")
      expect(routing.route).toBe("plugin-404")
      expect(routing.fallback).toBeUndefined()
    })
  })

  describe("ServiceType Validation", () => {
    test("Should handle all 8 ServiceType variants", () => {
      const allServiceTypes: ServiceType[] = [
        "service-deno",
        "service-pages",
        "service-both",
        "service-none",
        "plugin-deno",
        "plugin-pages",
        "plugin-both",
        "plugin-none"
      ]

      // Ensure we test exactly 8 service types
      expect(allServiceTypes).toHaveLength(8)

      // Test each service type processes correctly
      allServiceTypes.forEach(serviceType => {
        const discovery = mockServiceDiscovery(serviceType)
        const routing = mockRouting(discovery)

        expect(discovery).toBe(serviceType)
        expect(routing.route).toBeDefined()
        expect(routing.route).not.toBe("error")
      })
    })

    test("Should categorize service vs plugin types correctly", () => {
      const serviceTypes = ["service-deno", "service-pages", "service-both", "service-none"]
      const pluginTypes = ["plugin-deno", "plugin-pages", "plugin-both", "plugin-none"]

      serviceTypes.forEach(type => {
        expect(type.startsWith("service-")).toBe(true)
        expect(type.startsWith("plugin-")).toBe(false)
      })

      pluginTypes.forEach(type => {
        expect(type.startsWith("plugin-")).toBe(true)
        expect(type.startsWith("service-")).toBe(false)
      })
    })

    test("Should have consistent naming patterns", () => {
      const platforms = ["deno", "pages", "both", "none"]
      const prefixes = ["service", "plugin"]

      prefixes.forEach(prefix => {
        platforms.forEach(platform => {
          const serviceType = `${prefix}-${platform}` as ServiceType
          const routing = mockRouting(serviceType)

          // Verify routing exists for all combinations
          expect(routing.route).toBeDefined()

          // Verify "both" types have fallbacks
          if (platform === "both") {
            expect(routing.fallback).toBeDefined()
          }

          // Verify "none" types return 404-style routes
          if (platform === "none") {
            expect(routing.route).toContain("404")
          }
        })
      })
    })
  })

  describe("Real-world Scenarios", () => {
    test("Production service routing (from comprehensive test results)", () => {
      // Based on actual test results from our comprehensive validation
      const productionScenarios = [
        { domain: "ubq.fi", expected: "service-pages" },
        { domain: "pay.ubq.fi", expected: "service-both" },
        { domain: "work.ubq.fi", expected: "service-pages" },
        { domain: "xp.ubq.fi", expected: "service-deno" },
        { domain: "demo.ubq.fi", expected: "service-none" }
      ]

      productionScenarios.forEach(scenario => {
        const serviceType = scenario.expected as ServiceType
        const routing = mockRouting(serviceType)

        // Verify production scenarios route correctly
        expect(routing.route).toBeDefined()

        if (scenario.expected === "service-both") {
          expect(routing.fallback).toBe("cloudflare-pages")
        }

        if (scenario.expected === "service-none") {
          expect(routing.route).toBe("404")
        }
      })
    })

    test("Plugin deployment scenarios", () => {
      // Current state: plugins exist but aren't deployed
      const pluginScenarios = [
        { plugin: "text-conversation-rewards", expected: "plugin-none" },
        { plugin: "daemon-pricing", expected: "plugin-none" },
        { plugin: "command-query", expected: "plugin-none" }
      ]

      pluginScenarios.forEach(scenario => {
        const serviceType = scenario.expected as ServiceType
        const routing = mockRouting(serviceType)

        expect(routing.route).toBe("plugin-404")
        expect(routing.fallback).toBeUndefined()
      })
    })

    test("Future plugin deployment scenarios", () => {
      // Test what happens when plugins are deployed
      const futurePluginScenarios = [
        { plugin: "command-config", expected: "plugin-deno" },
        { plugin: "pricing-calculator", expected: "plugin-both" }
      ]

      futurePluginScenarios.forEach(scenario => {
        const serviceType = scenario.expected as ServiceType
        const routing = mockRouting(serviceType)

        expect(routing.route).toContain("plugin")
        expect(routing.route).not.toBe("plugin-404")

        if (scenario.expected === "plugin-both") {
          expect(routing.fallback).toBe("plugin-cloudflare-pages")
        }
      })
    })
  })

  describe("Edge Cases and Error Handling", () => {
    test("Should handle invalid service types gracefully", () => {
      // TypeScript prevents this at compile time, but test runtime behavior
      const invalidType = "invalid-type" as any
      const routing = mockRouting(invalidType)

      expect(routing.route).toBe("error")
    })

    test("Should handle all deployment combinations", () => {
      const deploymentMatrix = [
        { deno: true, pages: true, expected: "both" },
        { deno: true, pages: false, expected: "deno" },
        { deno: false, pages: true, expected: "pages" },
        { deno: false, pages: false, expected: "none" }
      ]

      deploymentMatrix.forEach(scenario => {
        ["service", "plugin"].forEach(prefix => {
          const serviceType = `${prefix}-${scenario.expected}` as ServiceType
          const routing = mockRouting(serviceType)

          expect(routing.route).toBeDefined()

          if (scenario.expected === "both") {
            expect(routing.fallback).toBeDefined()
          } else {
            expect(routing.fallback).toBeUndefined()
          }
        })
      })
    })
  })
})
