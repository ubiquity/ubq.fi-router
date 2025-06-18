/**
 * Test script to check plugin deployments on pages.dev
 */

// Test some known plugins that might be on pages.dev
const pluginsToTest = [
  'text-conversation-rewards',
  'daemon-disqualifier',
  'command-ask',
  'text-vector-embeddings',
  'daemon-merging'
]

async function testPluginDeployment(pluginName: string) {
  const urls = [
    `https://${pluginName}-main.deno.dev/manifest.json`,
    `https://${pluginName}-development.deno.dev/manifest.json`,
    `https://${pluginName}-main.pages.dev/manifest.json`,
    `https://${pluginName}-development.pages.dev/manifest.json`
  ]

  console.log(`\n🔍 Testing plugin: ${pluginName}`)

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000)
      })

      const platform = url.includes('.deno.dev') ? 'Deno' : 'Pages'
      const env = url.includes('-main.') ? 'main' : 'dev'

      if (response.status >= 200 && response.status < 300) {
        console.log(`  ✅ ${platform} ${env}: ${response.status}`)

        // Try to fetch actual manifest
        try {
          const manifestResponse = await fetch(url.replace('HEAD', 'GET'), {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
          })
          if (manifestResponse.ok) {
            const manifest = await manifestResponse.json()
            console.log(`    📝 Manifest: ${manifest.name || 'unnamed'}`)
          }
        } catch (e) {
          console.log(`    ❌ Manifest fetch failed`)
        }
      } else {
        console.log(`  ❌ ${platform} ${env}: ${response.status}`)
      }
    } catch (error) {
      const platform = url.includes('.deno.dev') ? 'Deno' : 'Pages'
      const env = url.includes('-main.') ? 'main' : 'dev'
      console.log(`  ❌ ${platform} ${env}: ${error.message}`)
    }
  }
}

async function main() {
  console.log('🧪 Testing plugin deployments on both Deno and Pages platforms...\n')

  for (const plugin of pluginsToTest) {
    await testPluginDeployment(plugin)
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  console.log('\n✅ Test completed!')
}

main().catch(console.error)
