import { rateLimitedKVWrite } from './rate-limited-kv-write'
import { kvGetWithFallback } from './kv-fallback-wrapper'

/**
 * Change detection utilities for GitHub repositories
 * Prevents unnecessary sitemap/plugin-map regenerations
 */

/**
 * Check if GitHub repositories have changed since last generation
 */
export async function hasRepositoryDataChanged(
  kvNamespace: any,
  cacheKeyPrefix: string,
  metadataKey: string
): Promise<boolean> {
  try {
    // Get the last generation timestamp
    const lastGenKey = `${cacheKeyPrefix}:last-generation`
    const lastGeneration = await kvGetWithFallback(kvNamespace, lastGenKey)

    if (!lastGeneration) {
      console.log(`🔄 No previous generation found for '${cacheKeyPrefix}', forcing regeneration.`)
      return true // Force regeneration if never generated before
    }

    // Get current metadata
    const currentMetadata = await kvGetWithFallback(kvNamespace, metadataKey, { type: 'json' })
    if (!currentMetadata) {
      console.log(`🔄 No current metadata found for '${metadataKey}', forcing regeneration.`)
      return true // Force regeneration if no metadata
    }

    // Get cached metadata from last generation
    const lastMetadataKey = `${cacheKeyPrefix}:last-metadata`
    const lastMetadata = await kvGetWithFallback(kvNamespace, lastMetadataKey, { type: 'json' })

    if (!lastMetadata) {
      console.log(`🔄 No previous metadata found for '${cacheKeyPrefix}', forcing regeneration.`)
      return true // Force regeneration if no previous metadata
    }

    // Compare metadata to detect changes
    const currentHash = generateMetadataHash(currentMetadata)
    const lastHash = generateMetadataHash(lastMetadata)

    if (currentHash !== lastHash) {
      console.log(`🔄 Repository changes detected for '${cacheKeyPrefix}' (hash changed).`)
      return true
    }

    console.log(`✅ No repository changes detected for '${cacheKeyPrefix}', skipping regeneration.`)
    return false

  } catch (error) {
    console.warn(`Failed to check repository changes for '${cacheKeyPrefix}':`, error)
    return true // Force regeneration on error to be safe
  }
}

/**
 * Record successful generation with current metadata
 */
export async function recordGeneration(
  kvNamespace: any,
  cacheKeyPrefix: string,
  metadataKey: string
): Promise<void> {
  try {
    const timestamp = new Date().toISOString()
    const lastGenKey = `${cacheKeyPrefix}:last-generation`
    const lastMetadataKey = `${cacheKeyPrefix}:last-metadata`

    // Get current metadata
    const currentMetadata = await kvGetWithFallback(kvNamespace, metadataKey, { type: 'json' })

    // Store generation timestamp and metadata snapshot
    await rateLimitedKVWrite(kvNamespace, lastGenKey, timestamp, 'change-detection', { expirationTtl: 7 * 24 * 60 * 60 })
    await rateLimitedKVWrite(kvNamespace, lastMetadataKey, JSON.stringify(currentMetadata), 'change-detection', { expirationTtl: 7 * 24 * 60 * 60 })

    console.log(`📝 Recorded generation for '${cacheKeyPrefix}' at ${timestamp}`)
  } catch (error) {
    console.warn(`Failed to record generation for '${cacheKeyPrefix}':`, error)
    // Don't throw - this is not critical for operation
  }
}

/**
 * Generate hash from metadata for comparison
 */
function generateMetadataHash(metadata: any): string {
  const sortedData = JSON.stringify(metadata, Object.keys(metadata).sort())
  return btoa(sortedData).slice(0, 32) // Use longer hash for metadata
}

/**
 * Check if sitemap regeneration is needed
 */
export async function shouldRegenerateSitemap(
  kvNamespace: any,
  forceRefresh: boolean = false
): Promise<boolean> {
  if (forceRefresh) {
    console.log(`🔄 Sitemap regeneration forced by refresh flag.`)
    return true
  }

  // Check if either services or plugins have changed
  const [servicesChanged, pluginsChanged] = await Promise.all([
    hasRepositoryDataChanged(kvNamespace, 'sitemap-services', 'github:service-metadata'),
    hasRepositoryDataChanged(kvNamespace, 'sitemap-plugins', 'github:plugin-metadata')
  ])

  const shouldRegenerate = servicesChanged || pluginsChanged

  if (shouldRegenerate) {
    console.log(`🔄 Sitemap regeneration needed: services=${servicesChanged}, plugins=${pluginsChanged}`)
  } else {
    console.log(`✅ Sitemap regeneration not needed - no repository changes detected.`)
  }

  return shouldRegenerate
}

/**
 * Check if plugin-map regeneration is needed
 */
export async function shouldRegeneratePluginMap(
  kvNamespace: any,
  forceRefresh: boolean = false
): Promise<boolean> {
  if (forceRefresh) {
    console.log(`🔄 Plugin-map regeneration forced by refresh flag.`)
    return true
  }

  const pluginsChanged = await hasRepositoryDataChanged(
    kvNamespace,
    'plugin-map-plugins',
    'github:plugin-metadata'
  )

  if (pluginsChanged) {
    console.log(`🔄 Plugin-map regeneration needed: plugins changed.`)
  } else {
    console.log(`✅ Plugin-map regeneration not needed - no plugin changes detected.`)
  }

  return pluginsChanged
}

/**
 * Record sitemap generation
 */
export async function recordSitemapGeneration(kvNamespace: any): Promise<void> {
  await Promise.all([
    recordGeneration(kvNamespace, 'sitemap-services', 'github:service-metadata'),
    recordGeneration(kvNamespace, 'sitemap-plugins', 'github:plugin-metadata')
  ])
}

/**
 * Record plugin-map generation
 */
export async function recordPluginMapGeneration(kvNamespace: any): Promise<void> {
  await recordGeneration(kvNamespace, 'plugin-map-plugins', 'github:plugin-metadata')
}
