import { coalesceDiscovery } from '../src/service-discovery'
import { buildDenoUrl, buildPagesUrl } from '../src/utils'

// Mock KV for testing
const mockKV = {
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

async function testServiceExists(url: string): Promise<boolean> {
  try {
    console.log(`🔍 Testing: ${url}`)
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    })
    console.log(`  Status: ${response.status}`)
    console.log(`  Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`)
    return response.status >= 200 && response.status < 300
  } catch (error) {
    console.log(`  Error: ${(error as Error).message}`)
    return false
  }
}

async function debugRootDomain() {
  console.log("🔍 Debugging root domain: ubq.fi\n")

  const subdomain = ""
  const url = new URL("https://ubq.fi")

  // Test the URLs that service discovery would check
  const denoUrl = buildDenoUrl(subdomain, url)
  const pagesUrl = buildPagesUrl(subdomain, url)

  console.log("📋 URLs being tested:")
  console.log(`  Deno Deploy: ${denoUrl}`)
  console.log(`  Cloudflare Pages: ${pagesUrl}\n`)

  // Test each service manually
  console.log("🧪 Manual service testing:")
  const denoExists = await testServiceExists(denoUrl)
  const pagesExists = await testServiceExists(pagesUrl)

  console.log(`\n📊 Results:`)
  console.log(`  Deno Deploy exists: ${denoExists}`)
  console.log(`  Cloudflare Pages exists: ${pagesExists}`)

  // Run through service discovery
  console.log(`\n🔄 Running service discovery...`)
  const serviceType = await coalesceDiscovery(subdomain, url, mockKV)
  console.log(`  Discovered service type: ${serviceType}`)

  // Expected vs actual
  console.log(`\n🎯 Analysis:`)
  if (pagesExists && !denoExists) {
    console.log(`  ✅ Expected: service-pages`)
    console.log(`  ${serviceType === 'service-pages' ? '✅' : '❌'} Actual: ${serviceType}`)
  } else if (denoExists && !pagesExists) {
    console.log(`  ✅ Expected: service-deno`)
    console.log(`  ${serviceType === 'service-deno' ? '✅' : '❌'} Actual: ${serviceType}`)
  } else if (denoExists && pagesExists) {
    console.log(`  ✅ Expected: service-both`)
    console.log(`  ${serviceType === 'service-both' ? '✅' : '❌'} Actual: ${serviceType}`)
  } else {
    console.log(`  ✅ Expected: service-none`)
    console.log(`  ${serviceType === 'service-none' ? '✅' : '❌'} Actual: ${serviceType}`)
  }
}

debugRootDomain().catch(console.error)
