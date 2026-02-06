/**
 * Core service and plugin discovery logic
 * DEFENSIVE: Graceful error handling for network failures
 */

import type { ServiceType, PluginManifest } from '../types'
import { buildDenoUrl, buildPagesUrl } from '../utils'
import { getKnownServices, getKnownPlugins } from '../utils'

/**
 * Check if a deployment exists - handle network errors gracefully
 */
export async function checkDeploymentExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000)
    })
    // Only 2xx status codes indicate working services
    return response.status >= 200 && response.status < 300
  } catch (error) {
    // Network errors, timeouts, DNS failures etc. mean service doesn't exist
    return false
  }
}

/**
 * Discover service type for a subdomain - gracefully handle network failures
 */
export async function discoverServiceType(subdomain: string, url: URL): Promise<ServiceType> {
  const denoUrl = buildDenoUrl(subdomain, url)
  const pagesUrl = buildPagesUrl(subdomain, url)

  // Check both platforms in parallel - gracefully handle network failures
  const [denoExists, pagesExists] = await Promise.all([
    checkDeploymentExists(denoUrl),
    checkDeploymentExists(pagesUrl)
  ])

  // Determine service type based on what exists
  if (denoExists && pagesExists) {
    return "service-both"
  } else if (denoExists) {
    return "service-deno"
  } else if (pagesExists) {
    return "service-pages"
  } else {
    return "service-none"
  }
}

/**
 * Fetch manifest from a variant URL
 */
async function fetchVariantManifest(variant: string): Promise<{ available: boolean; manifest?: PluginManifest }> {
  const manifestUrl = `https://${variant}.deno.dev/manifest.json`
  
  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000) // 10 second timeout
    })
    
    if (!response.ok) {
      return { available: false }
    }
    
    const manifest = await response.json() as PluginManifest
    
    if (!manifest.name || !manifest.description) {
      return { available: false }
    }
    
    return { available: true, manifest }
  } catch {
    return { available: false }
  }
}

/**
 * Discover both main and development variants for a plugin
 */
export async function discoverPluginVariants(baseName: string): Promise<{
  main: { available: boolean; manifest?: PluginManifest }
  development: { available: boolean; manifest?: PluginManifest }
}> {
  // Check both variants in parallel
  const [mainResult, devResult] = await Promise.all([
    fetchVariantManifest(`${baseName}-main`),
    fetchVariantManifest(`${baseName}-development`)
  ])
  
  return {
    main: mainResult,
    development: devResult
  }
}

/**
 * Get all services from GitHub or static fallback
 */
export async function getAllServices(githubToken: string): Promise<string[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required but not provided')
  }

  return await getKnownServices(githubToken)
}

/**
 * Get all plugins from GitHub or static fallback
 */
export async function getAllPlugins(githubToken: string): Promise<string[]> {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN is required but not provided')
  }

  return await getKnownPlugins(githubToken)
}

/**
 * Discover all services in parallel batches
 */
export async function discoverAllServices(githubToken: string): Promise<Map<string, ServiceType>> {
  const services = await getAllServices(githubToken)
  const servicesToTest = ['', ...services] // Include root domain

  const results = new Map<string, ServiceType>()

  // Process in batches
  const batchSize = 5
  for (let i = 0; i < servicesToTest.length; i += batchSize) {
    const batch = servicesToTest.slice(i, i + batchSize)

    const batchPromises = batch.map(async (subdomain) => {
      const url = new URL(subdomain ? `https://${subdomain}.ubq.fi` : 'https://ubq.fi')
      const serviceType = await discoverServiceType(subdomain, url)
      return [subdomain, serviceType] as const
    })

    const batchResults = await Promise.all(batchPromises)
    batchResults.forEach(([subdomain, serviceType]) => {
      results.set(subdomain, serviceType)
    })
  }

  return results
}

/**
 * Discover all plugins in batches - checks main and development variants
 */
export async function discoverAllPlugins(githubToken: string): Promise<Map<string, {
  main: { available: boolean; manifest?: PluginManifest }
  development: { available: boolean; manifest?: PluginManifest }
}>> {
  const plugins = await getAllPlugins(githubToken)
  
  const results = new Map<string, {
    main: { available: boolean; manifest?: PluginManifest }
    development: { available: boolean; manifest?: PluginManifest }
  }>()

  // Process in smaller batches to avoid timeouts
  const batchSize = 2
  for (let i = 0; i < plugins.length; i += batchSize) {
    const batch = plugins.slice(i, i + batchSize)

    const batchPromises = batch.map(async (pluginName) => {
      const variants = await discoverPluginVariants(pluginName)
      return [pluginName, variants] as const
    })

    const batchResults = await Promise.all(batchPromises)
    batchResults.forEach(([pluginName, variants]) => {
      results.set(pluginName, variants)
    })
  }

  return results
}
