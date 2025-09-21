import { lkgCache } from './memory-cache'
import { kvGetWithFallback, kvPutWithFallback, kvDeleteWithFallback } from '../utils/kv-fallback-wrapper'

type Platform = 'deno' | 'pages'

function keyFor(isPlugin: boolean, id: string): string {
  return `lkg:${isPlugin ? 'plugin' : 'service'}:${id}`
}

export async function getLastKnownGoodPlatform(
  kvNamespace: any,
  isPlugin: boolean,
  id: string
): Promise<Platform | null> {
  const k = keyFor(isPlugin, id)
  const mem = lkgCache.get(k)
  if (mem) return mem
  try {
    const val = await kvGetWithFallback(kvNamespace, k)
    if (val === 'deno' || val === 'pages') {
      lkgCache.set(k, val)
      return val
    }
  } catch {}
  return null
}

export async function setLastKnownGoodPlatform(
  kvNamespace: any,
  isPlugin: boolean,
  id: string,
  platform: Platform
): Promise<void> {
  const k = keyFor(isPlugin, id)
  const current = lkgCache.get(k)
  if (current === platform) return
  lkgCache.set(k, platform)
  // Write-through to KV with long TTL, but only on change
  try {
    await kvPutWithFallback(kvNamespace, k, platform, { expirationTtl: 30 * 24 * 60 * 60 })
  } catch {
    // ignore; best-effort persistence
  }
}

export async function clearLastKnownGoodPlatform(
  kvNamespace: any,
  isPlugin: boolean,
  id: string
): Promise<void> {
  const k = keyFor(isPlugin, id)
  try { lkgCache.delete(k) } catch {}
  try { await kvDeleteWithFallback(kvNamespace, k) } catch {}
}
