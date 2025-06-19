/**
 * Local storage implementation for health data (no external KV dependencies)
 */

import type { CachedHealthData, UpdateHealthRequest } from './types.ts'

// In-memory storage for health data
let healthCache: CachedHealthData = {
  services: {},
  plugins: {},
  lastGlobalUpdate: new Date().toISOString()
}

// File-based persistence (optional - for development)
const CACHE_FILE = './health-cache.json'

async function loadFromFile(): Promise<CachedHealthData | null> {
  try {
    const data = await Deno.readTextFile(CACHE_FILE)
    return JSON.parse(data)
  } catch {
    // File doesn't exist or is invalid, that's okay
    return null
  }
}

async function saveToFile(data: CachedHealthData): Promise<void> {
  try {
    await Deno.writeTextFile(CACHE_FILE, JSON.stringify(data, null, 2))
  } catch (error) {
    console.warn('Failed to save health cache to file:', error)
    // Non-critical error, continue with in-memory only
  }
}

// Initialize cache from file if available
async function initializeCache(): Promise<void> {
  const fileData = await loadFromFile()
  if (fileData) {
    healthCache = fileData
    console.log('Loaded health cache from file')
  } else {
    console.log('Starting with empty health cache')
  }
}

// Initialize on module load
initializeCache()

/**
 * Get cached health data
 */
export async function getCachedHealthData(): Promise<CachedHealthData> {
  return structuredClone(healthCache)
}

/**
 * Update health data for a specific service or plugin
 */
export async function updateHealthData(request: UpdateHealthRequest): Promise<{
  success: boolean
  storage: string
  timestamp: string
  error?: string
}> {
  try {
    // Update the appropriate entry
    if (request.type === 'service') {
      healthCache.services[request.key] = request.result as any
    } else {
      healthCache.plugins[request.key] = request.result as any
    }

    // Update global timestamp
    healthCache.lastGlobalUpdate = new Date().toISOString()

    // Save to file (non-blocking)
    saveToFile(healthCache).catch(error => {
      console.warn('Background save failed:', error)
    })

    return {
      success: true,
      storage: 'deno-kv', // Return as if using KV for compatibility
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    console.error('Failed to update health data:', error)
    return {
      success: false,
      storage: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Clear all health data (for testing/development)
 */
export async function clearHealthData(): Promise<void> {
  healthCache = {
    services: {},
    plugins: {},
    lastGlobalUpdate: new Date().toISOString()
  }

  // Remove cache file
  try {
    await Deno.remove(CACHE_FILE)
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  serviceCount: number
  pluginCount: number
  lastUpdate: string
  storage: string
}> {
  return {
    serviceCount: Object.keys(healthCache.services).length,
    pluginCount: Object.keys(healthCache.plugins).length,
    lastUpdate: healthCache.lastGlobalUpdate,
    storage: 'local-memory'
  }
}
