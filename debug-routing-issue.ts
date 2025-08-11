import { isPluginDomain } from './src/utils/is-plugin-domain.ts'
import { getPluginName } from './src/utils/get-plugin-name.ts'

const testHostnames = [
  'os-daemon-pricing.ubq.fi',
  'os-daemon-pricing-main.ubq.fi', 
  'os-daemon-pricing-dev.ubq.fi',
  'os-daemon-pricing-development.ubq.fi'
]

console.log('=== ROUTING DIAGNOSIS ===\n')

for (const hostname of testHostnames) {
  console.log(`Testing: ${hostname}`)
  
  // Step 1: Plugin domain detection
  const isPlugin = isPluginDomain(hostname)
  console.log(`  isPluginDomain: ${isPlugin}`)
  
  if (isPlugin) {
    // Step 2: Current discovery logic (BUGGY)
    const discoveryParam = hostname.replace('.ubq.fi', '').replace('os-', '')
    console.log(`  Discovery param: "${discoveryParam}"`)
    
    // Step 3: What discoverPluginType creates (BUGGY)
    const buggyUrl = `https://${discoveryParam}-main.deno.dev/manifest.json`
    console.log(`  Buggy URL: ${buggyUrl}`)
    
    // Step 4: What getPluginName creates (CORRECT)
    try {
      const correctName = await getPluginName(hostname, null, '', false)
      console.log(`  Correct name: "${correctName}"`)
      console.log(`  Correct URL: https://${correctName}.deno.dev/manifest.json`)
    } catch (e) {
      console.log(`  getPluginName error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  
  console.log('')
}

console.log('=== ROOT CAUSE ===')
console.log('discoverPluginType() hardcodes "-main" suffix instead of using proper hostname parsing')
console.log('This creates URLs like "daemon-pricing-main-main.deno.dev" (double main)')