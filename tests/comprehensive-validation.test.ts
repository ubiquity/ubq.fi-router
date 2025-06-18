import { expect, test, describe } from "bun:test"
import { coalesceDiscovery } from "../src/service-discovery"
import { getKnownServices, getKnownPlugins, buildPluginUrl } from "../src/utils"
import { buildDenoUrl, buildPagesUrl } from "../src/utils"
import type { ServiceType } from "../src/types"
import { GITHUB_TOKEN } from "../src/env"

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

interface PluginValidation {
  pluginDomain: string
  pluginName: string
  targetUrl: string
  manifestExists: boolean
  validManifest: boolean
  ubqDomainWorks: boolean
  ubqDomainStatus: number
  ubqDomainError?: string
  expectedServiceType: ServiceType
  actualServiceType: ServiceType
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

async function checkPluginManifest(url: string): Promise<{ exists: boolean; valid: boolean }> {
  try {
    const manifestUrl = `${url}/manifest.json`
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
      return { exists: false, valid: false }
    }

    const manifest = await response.json() as any
    const hasRequiredFields = manifest.name && manifest.description

    return {
      exists: true,
      valid: hasRequiredFields
    }
  } catch (error) {
    return { exists: false, valid: false }
  }
}

describe("Comprehensive Service Validation", () => {
  test("should validate all GitHub repos against actual deployments and ubq.fi routing", async () => {
    console.log("🔍 Starting comprehensive validation...\n")

    // Use GitHub token from environment loader
    const githubToken = GITHUB_TOKEN
    console.log("🔑 Using GitHub token for API requests")

    // Get all known services from GitHub
    const knownServices = await getKnownServices(realKV)
    console.log(`📋 Found ${knownServices.length} GitHub service repos:`)
    console.log(`   ${knownServices.join(", ")}\n`)

    const validations: ServiceValidation[] = []

    // Include root domain explicitly, then test ALL services
    const servicesToTest = ["", ...knownServices] // Include root domain + all services

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
      const actualServiceType = await coalesceDiscovery(subdomain, url, realKV, githubToken)

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

    // PLUGIN VALIDATION
    console.log("🔌 Starting plugin validation...\n")

    // Get known plugins from GitHub
    const knownPlugins = await getKnownPlugins(realKV)
    console.log(`🧩 Found ${knownPlugins.length} GitHub plugin repos:`)
    console.log(`   ${knownPlugins.slice(0, 10).join(", ")}${knownPlugins.length > 10 ? '...' : ''}\n`)

    const pluginValidations: PluginValidation[] = []

    // Test first 5 plugins with -main and -development variants
    const pluginsToTest = knownPlugins.slice(0, 5)

    for (const plugin of pluginsToTest) {
      const variants = [`${plugin}-main`, `${plugin}-development`]

      for (const variant of variants) {
        const pluginDomain = `os-${plugin}${variant.endsWith('-main') ? '' : '-development'}.ubq.fi`
        console.log(`🔌 Testing plugin: ${pluginDomain}`)

        try {
          const url = new URL(`https://${pluginDomain}`)
          const targetUrl = await buildPluginUrl(pluginDomain, url, realKV)

          console.log(`   🎯 Plugin name: ${variant}`)
          console.log(`   🟦 Target URL: ${targetUrl}`)

          // Check manifest
          const manifestResult = await checkPluginManifest(targetUrl.replace(/\/.*$/, ''))
          console.log(`   ${manifestResult.exists ? '✅' : '❌'} Manifest exists`)
          console.log(`   ${manifestResult.valid ? '✅' : '❌'} Manifest valid`)

          // Determine expected service type
          const expectedServiceType: ServiceType = (manifestResult.exists && manifestResult.valid) ? "plugin-deno" : "plugin-none"

          // Check if ubq.fi domain works
          const ubqResult = await checkUbqDomain(pluginDomain.replace('.ubq.fi', ''))

          console.log(`   🔍 Expected: ${expectedServiceType}`)
          console.log(`   🌐 ubq.fi domain: ${ubqResult.works ? '✅' : '❌'} (${ubqResult.status}${ubqResult.error ? ` - ${ubqResult.error}` : ''})`)

          pluginValidations.push({
            pluginDomain,
            pluginName: variant,
            targetUrl,
            manifestExists: manifestResult.exists,
            validManifest: manifestResult.valid,
            ubqDomainWorks: ubqResult.works,
            ubqDomainStatus: ubqResult.status,
            ubqDomainError: ubqResult.error,
            expectedServiceType,
            actualServiceType: expectedServiceType // For plugins, we don't run full service discovery
          })

        } catch (error) {
          console.log(`   ❌ Plugin error: ${(error as Error).message}`)

          pluginValidations.push({
            pluginDomain,
            pluginName: variant,
            targetUrl: 'error',
            manifestExists: false,
            validManifest: false,
            ubqDomainWorks: false,
            ubqDomainStatus: 0,
            ubqDomainError: (error as Error).message,
            expectedServiceType: "plugin-none",
            actualServiceType: "plugin-none"
          })
        }

        console.log() // Empty line for readability
      }
    }

    // Summary Report
    console.log("📊 COMPREHENSIVE VALIDATION SUMMARY")
    console.log("=" + "=".repeat(50))

    // Service metrics
    const serviceDiscoveryCorrect = validations.filter(v => v.expectedServiceType === v.actualServiceType).length
    const serviceUbqDomainsWorking = validations.filter(v => v.ubqDomainWorks).length
    const servicesWithDeployments = validations.filter(v => v.denoExists || v.pagesExists).length

    // Plugin metrics
    const pluginManifestsWorking = pluginValidations.filter(p => p.manifestExists && p.validManifest).length
    const pluginUbqDomainsWorking = pluginValidations.filter(p => p.ubqDomainWorks).length

    // Combined metrics
    const totalEntities = validations.length + pluginValidations.length
    const totalUbqDomainsWorking = serviceUbqDomainsWorking + pluginUbqDomainsWorking

    console.log(`\n🎯 Service Discovery Accuracy: ${serviceDiscoveryCorrect}/${validations.length} (${Math.round(serviceDiscoveryCorrect / validations.length * 100)}%)`)
    console.log(`🌐 Service UBQ.FI Domains Working: ${serviceUbqDomainsWorking}/${validations.length} (${Math.round(serviceUbqDomainsWorking / validations.length * 100)}%)`)
    console.log(`🚀 Services with Deployments: ${servicesWithDeployments}/${validations.length} (${Math.round(servicesWithDeployments / validations.length * 100)}%)`)

    console.log(`\n🔌 Plugin Manifests Working: ${pluginManifestsWorking}/${pluginValidations.length} (${Math.round(pluginManifestsWorking / pluginValidations.length * 100)}%)`)
    console.log(`🌐 Plugin UBQ.FI Domains Working: ${pluginUbqDomainsWorking}/${pluginValidations.length} (${Math.round(pluginUbqDomainsWorking / pluginValidations.length * 100)}%)`)

    console.log(`\n🌍 Total UBQ.FI Domains Working: ${totalUbqDomainsWorking}/${totalEntities} (${Math.round(totalUbqDomainsWorking / totalEntities * 100)}%)`)

    // Detailed breakdown
    console.log("\n📋 SERVICE TYPE BREAKDOWN:")
    const serviceTypeBreakdown = validations.reduce((acc, v) => {
      acc[v.actualServiceType] = (acc[v.actualServiceType] || 0) + 1
      return acc
    }, {} as Record<ServiceType, number>)

    Object.entries(serviceTypeBreakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`)
    })

    console.log("\n📋 PLUGIN TYPE BREAKDOWN:")
    const pluginTypeBreakdown = pluginValidations.reduce((acc, p) => {
      acc[p.actualServiceType] = (acc[p.actualServiceType] || 0) + 1
      return acc
    }, {} as Record<ServiceType, number>)

    Object.entries(pluginTypeBreakdown).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`)
    })

    // Issues found
    const serviceIssues = validations.filter(v =>
      v.expectedServiceType !== v.actualServiceType ||
      (!v.ubqDomainWorks && (v.denoExists || v.pagesExists))
    )

    const pluginIssues = pluginValidations.filter(p =>
      p.expectedServiceType !== p.actualServiceType ||
      (!p.ubqDomainWorks && p.manifestExists && p.validManifest)
    )

    const totalIssues = serviceIssues.length + pluginIssues.length

    if (totalIssues > 0) {
      console.log("\n⚠️  ISSUES FOUND:")

      serviceIssues.forEach(issue => {
        if (issue.expectedServiceType !== issue.actualServiceType) {
          console.log(`   🔍 ${issue.subdomain || 'root'}: Discovery mismatch - expected ${issue.expectedServiceType}, got ${issue.actualServiceType}`)
        }
        if (!issue.ubqDomainWorks && (issue.denoExists || issue.pagesExists)) {
          console.log(`   🌐 ${issue.subdomain || 'root'}: UBQ.FI domain not working but deployments exist (status: ${issue.ubqDomainStatus})`)
        }
      })

      pluginIssues.forEach(issue => {
        if (issue.expectedServiceType !== issue.actualServiceType) {
          console.log(`   🔌 ${issue.pluginDomain}: Plugin discovery mismatch - expected ${issue.expectedServiceType}, got ${issue.actualServiceType}`)
        }
        if (!issue.ubqDomainWorks && issue.manifestExists && issue.validManifest) {
          console.log(`   🌐 ${issue.pluginDomain}: UBQ.FI domain not working but manifest exists (status: ${issue.ubqDomainStatus})`)
        }
      })
    } else {
      console.log("\n✅ NO ISSUES FOUND - All services and plugins working as expected!")
    }

    console.log("\n🎉 Comprehensive validation complete!")

    // Test assertions
    expect(serviceDiscoveryCorrect).toBe(validations.length) // All service discovery should be correct
    expect(validations.length).toBeGreaterThan(0) // Should have tested some services
    expect(pluginValidations.length).toBeGreaterThan(0) // Should have tested some plugins

    // Store results for potential debugging
    console.log(`\n💾 Validation data available for ${validations.length} services and ${pluginValidations.length} plugins`)

  }, 60000) // 60 second timeout for comprehensive testing
})
