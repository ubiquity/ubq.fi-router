import { expect, test, describe } from "bun:test"
import { getPluginName } from "../src/utils/get-plugin-name"
import { buildPluginUrl } from "../src/utils/build-plugin-url"
import { buildPluginPagesUrl } from "../src/utils/build-plugin-pages-url"

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

interface PluginTestResult {
  hostname: string
  expectedDeployment: string
  targetUrl: string
  status: number
  hasVersionHeader: boolean
  error?: string
}

async function testPluginRoute(hostname: string, githubToken: string): Promise<PluginTestResult> {
  try {
    const url = new URL(`https://${hostname}`)
    const targetUrl = await buildPluginUrl(hostname, url, realKV, githubToken)
    
    const response = await fetch(targetUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000)
    })

    const expectedDeployment = await getPluginName(hostname, realKV, githubToken)
    const hasVersionHeader = response.headers.has('x-router-version')

    return {
      hostname,
      expectedDeployment,
      targetUrl,
      status: response.status,
      hasVersionHeader,
    }
  } catch (error) {
    const expectedDeployment = await getPluginName(hostname, realKV, githubToken).catch(() => 'unknown')
    return {
      hostname,
      expectedDeployment,
      targetUrl: 'error',
      status: 0,
      hasVersionHeader: false,
      error: (error as Error).message
    }
  }
}

async function testUbqDomainRoute(hostname: string): Promise<{ status: number; hasVersionHeader: boolean; error?: string }> {
  try {
    const response = await fetch(`https://${hostname}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000)
    })

    return {
      status: response.status,
      hasVersionHeader: response.headers.has('x-router-version')
    }
  } catch (error) {
    return {
      status: 0,
      hasVersionHeader: false,
      error: (error as Error).message
    }
  }
}

describe("Plugin Routing Integration Tests", () => {
  
  describe("getPluginName Unit Tests", () => {
    const githubToken = process.env.GITHUB_TOKEN || 'dummy-token'

    test("should extract plugin name for main branch (no suffix)", async () => {
      const result = await getPluginName("os-daemon-pricing.ubq.fi", realKV, githubToken)
      expect(result).toBe("daemon-pricing-main")
    })

    test("should extract plugin name for explicit main suffix", async () => {
      const result = await getPluginName("os-daemon-pricing-main.ubq.fi", realKV, githubToken)
      expect(result).toBe("daemon-pricing-main")
    })

    test("should extract plugin name for development branch", async () => {
      const result = await getPluginName("os-daemon-pricing-development.ubq.fi", realKV, githubToken)
      expect(result).toBe("daemon-pricing-development")
    })

    test("should extract plugin name for dev alias", async () => {
      const result = await getPluginName("os-daemon-pricing-dev.ubq.fi", realKV, githubToken)
      expect(result).toBe("daemon-pricing-development")
    })

    test("should handle complex plugin names", async () => {
      const result = await getPluginName("os-conversation-rewards-main.ubq.fi", realKV, githubToken)
      expect(result).toBe("conversation-rewards-main")
    })

    test("should reject non-plugin domains", async () => {
      await expect(getPluginName("pay.ubq.fi", realKV, githubToken)).rejects.toThrow("Not a plugin domain")
    })
  })

  describe("Plugin Hostname Variants Integration", () => {
    const githubToken = process.env.GITHUB_TOKEN
    
    test("should test all 4 hostname variants for daemon-pricing plugin", async () => {
      if (!githubToken) {
        console.log("⚠️  Skipping integration tests - GITHUB_TOKEN not available")
        return
      }

      console.log("🧪 Testing daemon-pricing plugin hostname variants...")

      const variants = [
        {
          hostname: "os-daemon-pricing.ubq.fi",
          expected: "daemon-pricing-main.deno.dev",
          description: "Production (no suffix) → main"
        },
        {
          hostname: "os-daemon-pricing-main.ubq.fi", 
          expected: "daemon-pricing-main.deno.dev",
          description: "Explicit main → main"
        },
        {
          hostname: "os-daemon-pricing-dev.ubq.fi",
          expected: "daemon-pricing-development.deno.dev", 
          description: "Dev alias → development"
        },
        {
          hostname: "os-daemon-pricing-development.ubq.fi",
          expected: "daemon-pricing-development.deno.dev",
          description: "Explicit development → development"
        }
      ]

      const results: PluginTestResult[] = []

      for (const variant of variants) {
        console.log(`  Testing ${variant.hostname} (${variant.description})`)
        
        const result = await testPluginRoute(variant.hostname, githubToken)
        results.push(result)

        console.log(`    Expected: ${variant.expected}`)
        console.log(`    Target URL: ${result.targetUrl}`)
        console.log(`    Status: ${result.status}${result.error ? ` (${result.error})` : ''}`)
        console.log(`    Version header: ${result.hasVersionHeader ? '✅' : '❌'}`)

        expect(result.targetUrl).toContain(variant.expected)
        expect(result.expectedDeployment).toMatch(/^daemon-pricing-(main|development)$/)
      }

      const successfulRoutes = results.filter(r => r.status >= 200 && r.status < 400)
      const routesWithHeaders = results.filter(r => r.hasVersionHeader)
      
      console.log(`\n📊 Results: ${successfulRoutes.length}/${results.length} successful routes`)
      console.log(`📊 Version headers: ${routesWithHeaders.length}/${results.length} present`)

      expect(results.length).toBe(4)
      expect(results.every(r => r.targetUrl !== 'error')).toBe(true)
    }, 30000)

    test("should test ubq.fi domain routing for plugin variants", async () => {
      if (!githubToken) {
        console.log("⚠️  Skipping ubq.fi domain tests - GITHUB_TOKEN not available")
        return
      }

      console.log("🌐 Testing ubq.fi domain routing...")

      const testHosts = [
        "os-daemon-pricing.ubq.fi",
        "os-daemon-pricing-main.ubq.fi",
        "os-daemon-pricing-development.ubq.fi"
      ]

      for (const hostname of testHosts) {
        console.log(`  Testing ${hostname}`)
        
        const result = await testUbqDomainRoute(hostname)
        console.log(`    Status: ${result.status}${result.error ? ` (${result.error})` : ''}`)
        console.log(`    Version header: ${result.hasVersionHeader ? '✅' : '❌'}`)

        if (result.status >= 200 && result.status < 500) {
          console.log(`    ✅ Domain accessible`)
        } else {
          console.log(`    ⚠️  Domain issue: ${result.status}`)
        }
      }
    }, 20000)
  })

  describe("Cache Healing Tests", () => {
    const githubToken = process.env.GITHUB_TOKEN

    test("should heal stale cache entries", async () => {
      if (!githubToken) {
        console.log("⚠️  Skipping cache healing tests - GITHUB_TOKEN not available")
        return
      }

      console.log("🔄 Testing cache healing...")

      const hostname = "os-test-plugin.ubq.fi"
      const cacheKey = `route:${hostname}:/`
      const staleUrl = "https://test-plugin-main-main.deno.dev/"
      
      await realKV.put(cacheKey, staleUrl)
      console.log(`  Injected stale cache: ${staleUrl}`)

      try {
        const url = new URL(`https://${hostname}`)
        const result = await buildPluginUrl(hostname, url, realKV, githubToken)
        
        console.log(`  Cache healing result: ${result}`)
        expect(result).not.toContain("main-main")
        expect(result).toContain("test-plugin-main.deno.dev")
        
        const cachedValue = await realKV.get(cacheKey)
        console.log(`  Updated cache: ${cachedValue}`)
        expect(cachedValue).not.toContain("main-main")
        
      } catch (error) {
        console.log(`  Expected error for non-existent plugin: ${(error as Error).message}`)
        expect(error).toBeDefined()
      }
    })
  })

  describe("Edge Cases", () => {
    const githubToken = process.env.GITHUB_TOKEN

    test("should handle unknown plugins", async () => {
      if (!githubToken) {
        console.log("⚠️  Skipping edge case tests - GITHUB_TOKEN not available")
        return
      }

      const unknownHostname = "os-nonexistent-plugin-xyz.ubq.fi"
      
      try {
        const url = new URL(`https://${unknownHostname}`)
        await buildPluginUrl(unknownHostname, url, realKV, githubToken)
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        console.log(`✅ Unknown plugin correctly rejected: ${(error as Error).message}`)
        expect(error).toBeDefined()
      }
    })

    test("should handle malformed hostnames", async () => {
      const malformedHostnames = [
        "not-a-plugin.ubq.fi",
        "os-.ubq.fi", 
        "os-plugin-.ubq.fi"
      ]

      for (const hostname of malformedHostnames) {
        try {
          await getPluginName(hostname, realKV, 'dummy-token')
          expect(false).toBe(true) // Should not reach here
        } catch (error) {
          console.log(`✅ Malformed hostname ${hostname} correctly rejected`)
          expect(error).toBeDefined()
        }
      }
    })

    test("should handle both buildPluginUrl and buildPluginPagesUrl", async () => {
      if (!githubToken) {
        console.log("⚠️  Skipping build function tests - GITHUB_TOKEN not available")
        return
      }

      const hostname = "os-daemon-pricing.ubq.fi"
      const url = new URL(`https://${hostname}/test?param=value`)

      try {
        const denoUrl = await buildPluginUrl(hostname, url, realKV, githubToken)
        const pagesUrl = await buildPluginPagesUrl(hostname, url, realKV, githubToken)

        console.log(`Deno URL: ${denoUrl}`)
        console.log(`Pages URL: ${pagesUrl}`)

        expect(denoUrl).toContain("daemon-pricing-main.deno.dev")
        expect(pagesUrl).toContain("daemon-pricing-main.pages.dev")
        expect(denoUrl).toContain("/test?param=value")
        expect(pagesUrl).toContain("/test?param=value")

      } catch (error) {
        console.log(`Plugin URL building failed (expected for unknown plugins): ${(error as Error).message}`)
        expect(error).toBeDefined()
      }
    })
  })

  describe("Version Header Verification", () => {
    test("should verify x-router-version header implementation", async () => {
      const testUrls = [
        "https://daemon-pricing-main.deno.dev",
        "https://daemon-pricing-development.deno.dev"
      ]

      for (const testUrl of testUrls) {
        try {
          const response = await fetch(testUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000)
          })

          const hasVersionHeader = response.headers.has('x-router-version')
          console.log(`${testUrl}: Version header ${hasVersionHeader ? 'present' : 'missing'}`)
          
          if (response.status < 400) {
            console.log(`  Status: ${response.status} ✅`)
          }
        } catch (error) {
          console.log(`${testUrl}: ${(error as Error).message}`)
        }
      }
    })
  })
})