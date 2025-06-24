/**
 * Plugin-map generation for ubq.fi router
 * Generates both XML and JSON plugin-maps based on discovered plugins
 */

import type { ServiceType, PluginManifest, PluginMapEntry, JsonPluginMap } from './types'

interface PluginDiscoveryResult {
  pluginName: string
  serviceType: ServiceType
  mainManifest?: PluginManifest
  developmentManifest?: PluginManifest
  mainAvailable: boolean
  developmentAvailable: boolean
}

/**
 * Calculate priority based on plugin metadata and deployments
 */
function calculatePluginPriority(serviceType: ServiceType, mainAvailable: boolean, developmentAvailable: boolean): number {
  // Plugins with both deployments get highest priority
  if (serviceType === 'plugin-both') return 0.9

  // Plugins with main deployment get high priority
  if (mainAvailable) return 0.8

  // Plugins with only development deployment get medium priority
  if (developmentAvailable) return 0.6

  // Non-existent plugins get low priority
  return 0.3
}

/**
 * Determine change frequency based on deployment status
 */
function getPluginChangeFrequency(serviceType: ServiceType): 'daily' | 'weekly' | 'monthly' {
  if (serviceType === 'plugin-none') return 'monthly'
  if (serviceType === 'plugin-both') return 'daily' // Both deployments = active development
  return 'weekly'
}

/**
 * Extract rich metadata from manifest
 */
function extractRichMetadata(manifest?: PluginManifest) {
  if (!manifest) return {}

  return {
    commands: manifest.commands,
    listeners: manifest["ubiquity:listeners"],
    configuration: manifest.configuration,
    homepage_url: manifest.homepage_url
  }
}

/**
 * Get the best manifest for display (prefer main, fallback to development)
 */
function getBestManifest(mainManifest?: PluginManifest, developmentManifest?: PluginManifest): PluginManifest | undefined {
  return mainManifest || developmentManifest
}

/**
 * Create plugin-map entry from discovery result
 */
export function createPluginMapEntry(discovery: PluginDiscoveryResult, lastmod: string): PluginMapEntry {
  const { pluginName, serviceType, mainManifest, developmentManifest, mainAvailable, developmentAvailable } = discovery

  const url = `https://os-${pluginName}.ubq.fi/`
  const priority = calculatePluginPriority(serviceType, mainAvailable, developmentAvailable)
  const changefreq = getPluginChangeFrequency(serviceType)

  // Get the best manifest for display information
  const bestManifest = getBestManifest(mainManifest, developmentManifest)
  const displayName = bestManifest?.name || pluginName
  const description = bestManifest?.description || `UBQ Plugin: ${pluginName}`

  // Extract rich metadata
  const richMetadata = extractRichMetadata(bestManifest)

  const entry: PluginMapEntry = {
    url,
    pluginName,
    displayName,
    description,
    serviceType,
    deployments: {
      main: {
        available: mainAvailable,
        url: `https://${pluginName}-main.deno.dev`,
        manifest: mainManifest
      },
      development: {
        available: developmentAvailable,
        url: `https://${pluginName}-development.deno.dev`,
        manifest: developmentManifest
      }
    },
    github: {
      repo: `ubiquity-os-marketplace/${pluginName}`,
      url: `https://github.com/ubiquity-os-marketplace/${pluginName}`
    },
    priority,
    changefreq,
    lastmod,
    ...richMetadata,
  }

  return entry
}

/**
 * Generate XML plugin-map from entries
 */
export function generateXmlPluginMap(entries: PluginMapEntry[]): string {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>'
  const urlsetOpen = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  const urlsetClose = '</urlset>'

  const urls = entries
    .filter(entry => entry.serviceType !== 'plugin-none') // Exclude non-existent plugins
    .map(entry => {
      return `  <url>
    <loc>${entry.url}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority.toFixed(1)}</priority>
    <!-- Plugin: ${entry.pluginName} -->
    <!-- Display Name: ${entry.displayName} -->
    <!-- Description: ${entry.description} -->
    <!-- Deployments: main=${entry.deployments.main.available}, dev=${entry.deployments.development.available} -->
  </url>`
    })
    .join('\n')

  return `${xmlHeader}
${urlsetOpen}
${urls}
${urlsetClose}`
}

/**
 * Generate JSON plugin-map from entries
 */
export function generateJsonPluginMap(entries: PluginMapEntry[], generationTimestamp: string): JsonPluginMap {
  // Filter out non-existent plugins
  const validEntries = entries.filter(entry => entry.serviceType !== 'plugin-none');

  return {
    version: '1.0',
    generated: generationTimestamp,
    generator: 'ubq.fi-router',
    totalPlugins: validEntries.length,
    plugins: validEntries,
  };
}

/**
 * Format XML response with proper headers
 */
export function createXmlPluginMapResponse(xmlContent: string): Response {
  return new Response(xmlContent, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=7200', // 2 hours
      'X-Generator': 'ubq.fi-router-plugin-map'
    }
  })
}

/**
 * Format JSON response with proper headers
 */
export function createJsonPluginMapResponse(jsonContent: JsonPluginMap): Response {
  return new Response(JSON.stringify(jsonContent, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=7200', // 2 hours
      'X-Generator': 'ubq.fi-router-plugin-map'
    }
  })
}
