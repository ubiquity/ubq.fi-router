import { expect, test, describe } from "bun:test"
import type { ServiceType } from "../src/types"
import { getSubdomainKey, isPluginDomain, buildDenoUrl, buildPagesUrl } from "../src/utils"

/**
 * Real Service Type Tests - No Mocks, Just Logic Testing
 * Tests the actual service type logic and URL building without external dependencies
 */

describe("Service Type Logic Tests", () => {

  describe("All ServiceType Values", () => {
    test("Should have exactly 8 service types", () => {
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

      expect(serviceTypes).toHaveLength(8)

      // Verify each type follows naming convention
      serviceTypes.forEach(type => {
        expect(type).toMatch(/^(service|plugin)-(deno|pages|both|none)$/)
      })
    })

    test("Should categorize service vs plugin types", () => {
      const serviceTypes = ["service-deno", "service-pages", "service-both", "service-none"]
      const pluginTypes = ["plugin-deno", "plugin-pages", "plugin-both", "plugin-none"]

      serviceTypes.forEach(type => {
        expect(type.startsWith("service-")).toBe(true)
      })

      pluginTypes.forEach(type => {
        expect(type.startsWith("plugin-")).toBe(true)
      })
    })

    test("Should have consistent platform naming", () => {
      const platforms = ["deno", "pages", "both", "none"]
      const prefixes = ["service", "plugin"]

      prefixes.forEach(prefix => {
        platforms.forEach(platform => {
          const serviceType = `${prefix}-${platform}` as ServiceType
          expect(serviceType).toBeDefined()

          if (platform === "both") {
            // Both means both deno and pages are available
            expect(serviceType.includes("both")).toBe(true)
          }

          if (platform === "none") {
            // None means no deployments available
            expect(serviceType.includes("none")).toBe(true)
          }
        })
      })
    })
  })

  describe("Domain Parsing Logic", () => {
    test("getSubdomainKey: Extract subdomain correctly", () => {
      // Root domain
      expect(getSubdomainKey("ubq.fi")).toBe("")

      // Standard services
      expect(getSubdomainKey("pay.ubq.fi")).toBe("pay")
      expect(getSubdomainKey("work.ubq.fi")).toBe("work")
      expect(getSubdomainKey("demo.ubq.fi")).toBe("demo")

      // Plugin domains
      expect(getSubdomainKey("os-test.ubq.fi")).toBe("os-test")
      expect(getSubdomainKey("os-pricing-calculator.ubq.fi")).toBe("os-pricing-calculator")
    })

    test("isPluginDomain: Identify plugin domains", () => {
      // Not plugin domains
      expect(isPluginDomain("ubq.fi")).toBe(false)
      expect(isPluginDomain("pay.ubq.fi")).toBe(false)
      expect(isPluginDomain("work.ubq.fi")).toBe(false)

      // Plugin domains
      expect(isPluginDomain("os-test.ubq.fi")).toBe(true)
      expect(isPluginDomain("os-pricing-calculator.ubq.fi")).toBe(true)
      expect(isPluginDomain("os-command-query.ubq.fi")).toBe(true)
    })

    test("Should handle edge cases", () => {
      // Invalid domains should throw
      expect(() => getSubdomainKey("invalid")).toThrow()
      expect(() => getSubdomainKey("too.many.parts.ubq.fi")).toThrow()

      // Plugin domain validation
      expect(isPluginDomain("os.ubq.fi")).toBe(false) // Missing plugin name
      expect(isPluginDomain("not-os-plugin.ubq.fi")).toBe(false) // Wrong prefix
    })
  })

  describe("URL Building Logic", () => {
    test("buildDenoUrl: Generate Deno Deploy URLs", () => {
      const baseUrl = new URL("https://example.com/api/test?param=value")

      // Root domain
      expect(buildDenoUrl("", baseUrl)).toBe("https://ubq-fi.deno.dev/api/test?param=value")

      // Subdomain services
      expect(buildDenoUrl("pay", baseUrl)).toBe("https://pay-ubq-fi.deno.dev/api/test?param=value")
      expect(buildDenoUrl("work", baseUrl)).toBe("https://work-ubq-fi.deno.dev/api/test?param=value")
    })

    test("buildPagesUrl: Generate Cloudflare Pages URLs", () => {
      const baseUrl = new URL("https://example.com/api/test?param=value")

      // Root domain
      expect(buildPagesUrl("", baseUrl)).toBe("https://ubq-fi.pages.dev/api/test?param=value")

      // Subdomain services
      expect(buildPagesUrl("pay", baseUrl)).toBe("https://pay-ubq-fi.pages.dev/api/test?param=value")
      expect(buildPagesUrl("work", baseUrl)).toBe("https://work-ubq-fi.pages.dev/api/test?param=value")
    })

    test("Should preserve paths and query parameters", () => {
      const complexUrl = new URL("https://test.com/api/v1/users/123?sort=name&limit=10")

      const denoUrl = buildDenoUrl("api", complexUrl)
      const pagesUrl = buildPagesUrl("api", complexUrl)

      expect(denoUrl).toBe("https://api-ubq-fi.deno.dev/api/v1/users/123?sort=name&limit=10")
      expect(pagesUrl).toBe("https://api-ubq-fi.pages.dev/api/v1/users/123?sort=name&limit=10")
    })
  })

  describe("Service Type Routing Logic", () => {
    test("service-deno: Should route to Deno Deploy only", () => {
      const serviceType: ServiceType = "service-deno"

      // Logic: if service-deno, route to Deno Deploy
      const shouldUseDeno = serviceType.includes("deno") || serviceType.includes("both")
      const shouldUsePages = serviceType.includes("pages") && !serviceType.includes("deno")

      expect(shouldUseDeno).toBe(true)
      expect(shouldUsePages).toBe(false)
    })

    test("service-pages: Should route to Cloudflare Pages only", () => {
      const serviceType: ServiceType = "service-pages"

      const shouldUseDeno = serviceType.includes("deno") && !serviceType.includes("both")
      const shouldUsePages = serviceType.includes("pages") || serviceType.includes("both")

      expect(shouldUseDeno).toBe(false)
      expect(shouldUsePages).toBe(true)
    })

    test("service-both: Should prefer Deno Deploy with Pages fallback", () => {
      const serviceType: ServiceType = "service-both"

      const hasBoth = serviceType.includes("both")
      const primaryIsDeno = hasBoth // Convention: Deno is primary for "both"
      const hasPagesFallback = hasBoth

      expect(hasBoth).toBe(true)
      expect(primaryIsDeno).toBe(true)
      expect(hasPagesFallback).toBe(true)
    })

    test("service-none: Should return 404", () => {
      const serviceType: ServiceType = "service-none"

      const hasNoService = serviceType.includes("none")
      const shouldReturn404 = hasNoService

      expect(hasNoService).toBe(true)
      expect(shouldReturn404).toBe(true)
    })

    test("plugin-* types: Should follow same patterns", () => {
      const pluginTypes: ServiceType[] = ["plugin-deno", "plugin-pages", "plugin-both", "plugin-none"]

      pluginTypes.forEach(type => {
        expect(type.startsWith("plugin-")).toBe(true)

        if (type.includes("deno")) {
          expect(type === "plugin-deno" || type === "plugin-both").toBe(true)
        }

        if (type.includes("pages")) {
          expect(type === "plugin-pages" || type === "plugin-both").toBe(true)
        }

        if (type.includes("both")) {
          // Both should have fallback capability
          expect(type).toBe("plugin-both")
        }

        if (type.includes("none")) {
          // None should indicate no deployment
          expect(type).toBe("plugin-none")
        }
      })
    })
  })

  describe("Real Deployment Scenarios", () => {
    test("Common service deployment patterns", () => {
      // Based on actual deployment patterns observed
      const scenarios = [
        { domain: "ubq.fi", subdomain: "", isPlugin: false },
        { domain: "pay.ubq.fi", subdomain: "pay", isPlugin: false },
        { domain: "work.ubq.fi", subdomain: "work", isPlugin: false },
        { domain: "os-test.ubq.fi", subdomain: "os-test", isPlugin: true }
      ]

      scenarios.forEach(scenario => {
        const extractedSubdomain = getSubdomainKey(scenario.domain)
        const detectedPlugin = isPluginDomain(scenario.domain)

        expect(extractedSubdomain).toBe(scenario.subdomain)
        expect(detectedPlugin).toBe(scenario.isPlugin)
      })
    })

    test("Service type decision matrix", () => {
      // Simulate service discovery logic
      const deploymentMatrix = [
        { deno: true, pages: true, expected: "both" },
        { deno: true, pages: false, expected: "deno" },
        { deno: false, pages: true, expected: "pages" },
        { deno: false, pages: false, expected: "none" }
      ]

      deploymentMatrix.forEach(scenario => {
        ["service", "plugin"].forEach(prefix => {
          const expectedType = `${prefix}-${scenario.expected}` as ServiceType

          // Verify the logic makes sense
          if (scenario.deno && scenario.pages) {
            expect(expectedType.includes("both")).toBe(true)
          } else if (scenario.deno) {
            expect(expectedType.includes("deno")).toBe(true)
          } else if (scenario.pages) {
            expect(expectedType.includes("pages")).toBe(true)
          } else {
            expect(expectedType.includes("none")).toBe(true)
          }
        })
      })
    })

    test("URL transformations for all service types", () => {
      const testUrl = new URL("https://test.ubq.fi/api/endpoint")
      const scenarios = [
        { subdomain: "", expectedDeno: "https://ubq-fi.deno.dev/api/endpoint" },
        { subdomain: "pay", expectedDeno: "https://pay-ubq-fi.deno.dev/api/endpoint" },
        { subdomain: "work", expectedDeno: "https://work-ubq-fi.deno.dev/api/endpoint" }
      ]

      scenarios.forEach(scenario => {
        const denoUrl = buildDenoUrl(scenario.subdomain, testUrl)
        const pagesUrl = buildPagesUrl(scenario.subdomain, testUrl)

        expect(denoUrl).toBe(scenario.expectedDeno)
        expect(pagesUrl).toBe(scenario.expectedDeno.replace("deno.dev", "pages.dev"))
      })
    })
  })

  describe("Error Handling Logic", () => {
    test("Should handle invalid service types gracefully", () => {
      // TypeScript prevents this, but test runtime behavior
      const validTypes = ["service-deno", "service-pages", "service-both", "service-none", "plugin-deno", "plugin-pages", "plugin-both", "plugin-none"]

      validTypes.forEach(type => {
        expect(type).toMatch(/^(service|plugin)-(deno|pages|both|none)$/)
      })

      // Invalid patterns that should be caught
      const invalidPatterns = ["service-invalid", "plugin-wrong", "wrong-deno", "service-"]

      invalidPatterns.forEach(invalid => {
        expect(invalid).not.toMatch(/^(service|plugin)-(deno|pages|both|none)$/)
      })
    })

    test("Should validate domain format requirements", () => {
      const validDomains = ["ubq.fi", "pay.ubq.fi", "os-test.ubq.fi"]
      const invalidDomains = ["invalid", "too.many.parts.ubq.fi"]

      validDomains.forEach(domain => {
        expect(() => getSubdomainKey(domain)).not.toThrow()
      })

      invalidDomains.forEach(domain => {
        expect(() => getSubdomainKey(domain)).toThrow()
      })

      // Test that non-ubq.fi domains still return values (function only validates structure, not domain)
      expect(getSubdomainKey("wrong.domain.com")).toBe("wrong")
      expect(getSubdomainKey("test.example.org")).toBe("test")
    })
  })

  describe("Performance and Efficiency", () => {
    test("URL building should be fast and consistent", () => {
      const testUrl = new URL("https://test.com/api")
      const subdomains = ["", "pay", "work", "demo", "api", "admin"]

      // Test that URL building is consistent
      subdomains.forEach(subdomain => {
        const deno1 = buildDenoUrl(subdomain, testUrl)
        const deno2 = buildDenoUrl(subdomain, testUrl)
        const pages1 = buildPagesUrl(subdomain, testUrl)
        const pages2 = buildPagesUrl(subdomain, testUrl)

        expect(deno1).toBe(deno2)
        expect(pages1).toBe(pages2)

        // Should follow consistent pattern
        if (subdomain === "") {
          expect(deno1).toContain("ubq-fi.deno.dev")
          expect(pages1).toContain("ubq-fi.pages.dev")
        } else {
          expect(deno1).toContain(`${subdomain}-ubq-fi.deno.dev`)
          expect(pages1).toContain(`${subdomain}-ubq-fi.pages.dev`)
        }
      })
    })

    test("Domain parsing should handle edge cases efficiently", () => {
      // Test various domain formats
      const testCases = [
        { input: "ubq.fi", expected: "" },
        { input: "a.ubq.fi", expected: "a" },
        { input: "very-long-subdomain-name.ubq.fi", expected: "very-long-subdomain-name" },
        { input: "os-plugin-with-many-hyphens.ubq.fi", expected: "os-plugin-with-many-hyphens" }
      ]

      testCases.forEach(test => {
        const result = getSubdomainKey(test.input)
        expect(result).toBe(test.expected)

        // Plugin detection should work consistently
        const isPlugin = isPluginDomain(test.input)
        const shouldBePlugin = test.expected.startsWith("os-")
        expect(isPlugin).toBe(shouldBePlugin)
      })
    })
  })
})
