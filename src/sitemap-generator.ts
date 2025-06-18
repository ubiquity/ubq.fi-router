/**
 * Dynamic sitemap generation for ubq.fi router
 * Generates both XML and JSON sitemaps based on discovered services
 */

import type { ServiceType } from './types'

export interface SitemapEntry {
  url: string
  serviceType: ServiceType
  priority: number
  changefreq: 'daily' | 'weekly' | 'monthly'
  lastmod: string
  deployment: {
    deno: boolean
    pages: boolean
  }
  metadata?: {
    pluginManifest?: any
    githubRepo?: string
  }
}

export interface JsonSitemap {
  version: string
  generated: string
  generator: string
  totalUrls: number
  urls: SitemapEntry[]
}

/**
 * Calculate priority based on service type and subdomain
 */
function calculatePriority(subdomain: string, serviceType: ServiceType): number {
  // Root domain gets highest priority
  if (subdomain === '') return 1.0
  
  // Core services get high priority
  const coreServices = ['pay', 'work', 'audit', 'onboard']
  if (coreServices.includes(subdomain)) return 0.9
  
  // Regular services
  if (serviceType.startsWith('service-')) return 0.8
  
  // Plugins get lower priority
  if (serviceType.startsWith('plugin-')) return 0.6
  
  return 0.5
}

/**
 * Determine change frequency based on service type
 */
function getChangeFrequency(serviceType: ServiceType): 'daily' | 'weekly' | 'monthly' {
  if (serviceType.startsWith('plugin-')) return 'weekly'
  if (serviceType === 'service-none' || serviceType === 'plugin-none') return 'monthly'
  return 'weekly'
}

/**
 * Extract deployment info from service type
 */
function getDeploymentInfo(serviceType: ServiceType): { deno: boolean; pages: boolean } {
  switch (serviceType) {
    case 'service-deno':
    case 'plugin-deno':
      return { deno: true, pages: false }
    case 'service-pages':
    case 'plugin-pages':
      return { deno: false, pages: true }
    case 'service-both':
    case 'plugin-both':
      return { deno: true, pages: true }
    default:
      return { deno: false, pages: false }
  }
}

/**
 * Create sitemap entry from discovered service
 */
export function createSitemapEntry(
  subdomain: string,
  serviceType: ServiceType,
  pluginManifest?: any,
  githubRepo?: string
): SitemapEntry {
  const domain = subdomain === '' ? 'ubq.fi' : `${subdomain}.ubq.fi`
  const url = `https://${domain}/`
  const priority = calculatePriority(subdomain, serviceType)
  const changefreq = getChangeFrequency(serviceType)
  const deployment = getDeploymentInfo(serviceType)
  const lastmod = new Date().toISOString()

  const entry: SitemapEntry = {
    url,
    serviceType,
    priority,
    changefreq,
    lastmod,
    deployment
  }

  // Add metadata if available
  if (pluginManifest || githubRepo) {
    entry.metadata = {}
    if (pluginManifest) entry.metadata.pluginManifest = pluginManifest
    if (githubRepo) entry.metadata.githubRepo = githubRepo
  }

  return entry
}

/**
 * Generate XML sitemap from entries
 */
export function generateXmlSitemap(entries: SitemapEntry[]): string {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>'
  const urlsetOpen = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  const urlsetClose = '</urlset>'

  const urls = entries
    .filter(entry => !entry.serviceType.endsWith('-none')) // Exclude non-existent services
    .map(entry => {
      return `  <url>
    <loc>${entry.url}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority.toFixed(1)}</priority>
  </url>`
    })
    .join('\n')

  return `${xmlHeader}
${urlsetOpen}
${urls}
${urlsetClose}`
}

/**
 * Generate JSON sitemap from entries
 */
export function generateJsonSitemap(entries: SitemapEntry[]): JsonSitemap {
  // Filter out non-existent services
  const validEntries = entries.filter(entry => !entry.serviceType.endsWith('-none'))

  return {
    version: '1.0',
    generated: new Date().toISOString(),
    generator: 'ubq.fi-router',
    totalUrls: validEntries.length,
    urls: validEntries
  }
}

/**
 * Format XML response with proper headers
 */
export function createXmlResponse(xmlContent: string): Response {
  return new Response(xmlContent, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=21600', // 6 hours
      'X-Generator': 'ubq.fi-router'
    }
  })
}

/**
 * Format JSON response with proper headers
 */
export function createJsonResponse(jsonContent: JsonSitemap): Response {
  return new Response(JSON.stringify(jsonContent, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=21600', // 6 hours
      'X-Generator': 'ubq.fi-router'
    }
  })
}
