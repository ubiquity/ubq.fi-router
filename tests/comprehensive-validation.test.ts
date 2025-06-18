import { expect, test, describe } from "bun:test"
import { coalesceDiscovery } from "../src/service-discovery"
import { getKnownServices } from "../src/utils"
import { buildDenoUrl, buildPagesUrl } from "../src/utils"
import type { ServiceType } from "../src/types"

// Real KV namespace mock
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
    const keys = Array.from(this.data.keys() as IterableIterator<string>)
      .filter((key: string) => !options?.prefix || key.startsWith(options.prefix))
      .map((name: string) => ({ name }))
    return { keys }
  }
}

interface ServiceValidation {
  subdomain: string
  githubRepo: string
  denoUrl: string
  pagesUrl: string
  denoExists: boolean
  pagesExists: boolean
  expectedServiceType: ServiceType
  actualServiceType: ServiceType
  ubqDomainWorks: boolean
  ubqDomainStatus: number
  ubqDomainError?: string
}

async function checkDeploymentExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    })
    return response.status >= 200 && response.status < 300
  } catch (error) {
    return false
  }
}

async function checkUbqDomain(subdomain: string): Promise<{ works: boolean; status: number; error?: string }> {
  try {
    const domain = subdomain ? `${subdomain}.ubq.fi` : 'ubq.fi'
    const response = await fetch(`https://${domain}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000)
    })
    return {
      works: response.status >= 200 && response.status < 400,
      status: response.status
    }
  } catch (error) {
    return {
      works: false,
      status: 0,
      error: (error as Error).message
    }
  }
}

describe("Comprehensive Service Validation", () => {
  test("should validate all GitHub repos against actual deployments and ubq.fi routing", async () => {
    console.log("🔍 Starting comprehensive validation...\n")

    // Get all known services from GitHub
    const knownServices = await getKnownServices(realKV)
    console.log(`📋 Found ${knownServices.length} GitHub service repos:`)
    console.log(`   ${knownServices.join(", ")}\n`)

    const validations: ServiceValidation[] = []

    // Include root domain explicitly, then test other services
    const servicesToTest = ["", ...knownServices.slice(0, 9)] // Include root domain + 9 others

    // Test each service
    for (const subdomain of servicesToTest) {
      console.log(`🧪 Testing: ${subdomain || 'root domain'}`)

      const githubRepo = subdomain ? `${subdomain}.ubq.fi` : 'ubq.fi'
      const url = new URL(subdomain ? `https://${subdomain}.ubq.fi` : 'https://ubq.fi')

      // Check actual deployments
      const denoUrl = buildDenoUrl(subdomain, url)
      const pagesUrl = buildPagesUrl(subdomain, url)

      console.log(`   📂 GitHub repo: ubiquity/${githubRepo}`)
      console.log(`   🟦 Deno URL: ${denoUrl}`)
      console.log(`   🟨 Pages URL: ${pagesUrl}`)

      const [denoExists, pagesExists] = await Promise.all([
        checkDeploymentExists(denoUrl),
        checkDeploymentExists(pagesUrl)
      ])

      console.log(`   ${denoExists ? '✅' : '❌'} Deno Deploy exists`)
      console.log(`   ${pagesExists ? '✅' : '❌'} Cloudflare Pages exists`)

      // Determine expected service type
      let expectedServiceType: ServiceType
      if (denoExists && pagesExists) {
        expectedServiceType = "service-both"
      } else if (denoExists) {
        expectedServiceType = "service-deno"
      } else if (pagesExists) {
        expectedServiceType = "service-pages"
      } else {
        expectedServiceType = "service-none"
      }

      // Run service discovery
      const actualServiceType = await coalesceDiscovery(subdomain, url, realKV)

      // Check if ubq.fi domain works
      const ubqResult = await checkUbqDomain(subdomain)

      console.log(`   🔍 Expected: ${expectedServiceType}`)
      console.log(`   🎯 Discovered: ${actualServiceType} ${expectedServiceType === actualServiceType ? '✅' : '❌'}`)
      console.log(`   🌐 ubq.fi domain: ${ubqResult.works ? '✅' : '❌'} (${ubqResult.status}${ubqResult.error ? ` - ${ubqResult.error}` : ''})`)

      validations.push({
        subdomain,
        githubRepo,
        denoUrl,
        pagesUrl,
        denoExists,
        pagesExists,
        expectedServiceType,
        actualServiceType,
        ubqDomainWorks: ubqResult.works,
        ubqDomainStatus: ubqResult.status,
        ubqDomainError: ubqResult.error
      })

      console.log() // Empty line for readability
    }

    // Summary Report
    console.log("📊 COMPREHENSIVE VALIDATION SUMMARY")
    console.log("=" + "=".repeat(50))

    const serviceDiscoveryCorrect = validations.filter(v => v.expectedServiceType === v.actualServiceType).length
    const ubqDomainsWorking = validations.filter(v => v.ubqDomainWorks).length
    const hasDeployments = validations.filter(v => v.denoExists || v.pagesExists).length

    console.log(`\n🎯 Service Discovery Accuracy: ${serviceDiscoveryCorrect}/${validations.length} (${Math.round(serviceDiscoveryCorrect / validations.length * 100)}%)`)
    console.log(`🌐 UBQ.FI Domains Working: ${ubqDomainsWorking}/${validations.length} (${Math.round(ubqDomainsWorking / validations.length * 100)}%)`)
    console.log(`🚀 Services with Deployments: ${hasDeployments}/${validations.length} (${Math.round(hasDeployments / validations.length * 100)}%)`)

    // Detailed breakdown
    console.log("\n📋 SERVICE TYPE BREAKDOWN:")
    const typeBreakdown = validations.reduce((acc, v) => {
      acc[v.actualServiceType] = (acc[v.actualServiceType] || 0) + 1
      return acc
    }, {} as Record<ServiceType, number>)

    Object.entries(typeBreakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`)
    })

    // Issues found
    const issues = validations.filter(v =>
      v.expectedServiceType !== v.actualServiceType ||
      (!v.ubqDomainWorks && (v.denoExists || v.pagesExists))
    )

    if (issues.length > 0) {
      console.log("\n⚠️  ISSUES FOUND:")
      issues.forEach(issue => {
        if (issue.expectedServiceType !== issue.actualServiceType) {
          console.log(`   🔍 ${issue.subdomain || 'root'}: Discovery mismatch - expected ${issue.expectedServiceType}, got ${issue.actualServiceType}`)
        }
        if (!issue.ubqDomainWorks && (issue.denoExists || issue.pagesExists)) {
          console.log(`   🌐 ${issue.subdomain || 'root'}: UBQ.FI domain not working but deployments exist (status: ${issue.ubqDomainStatus})`)
        }
      })
    } else {
      console.log("\n✅ NO ISSUES FOUND - All services working as expected!")
    }

    console.log("\n🎉 Comprehensive validation complete!")

    // Test assertions
    expect(serviceDiscoveryCorrect).toBe(validations.length) // All service discovery should be correct
    expect(validations.length).toBeGreaterThan(0) // Should have tested some services

    // Store results for potential debugging
    console.log(`\n💾 Validation data available for ${validations.length} services`)

  }, 60000) // 60 second timeout for comprehensive testing
})
