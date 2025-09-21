import { circuitBreakerCache, type BreakerState } from './memory-cache'

type Platform = 'deno' | 'pages'

const THRESHOLD = 3 // consecutive failures
const OPEN_MS = 60_000 // ~60s
const WINDOW_MS = 60_000 // failures counted within this window

function key(id: string, platform: Platform): string {
  return `cb:${id}:${platform}`
}

export function isCircuitOpen(id: string, platform: Platform): boolean {
  const k = key(id, platform)
  const st = circuitBreakerCache.get(k)
  return !!(st && st.openUntil !== null && st.openUntil > Date.now())
}

export function recordFailure(id: string, platform: Platform): void {
  const k = key(id, platform)
  const now = Date.now()
  const st: BreakerState = circuitBreakerCache.get(k) ?? { failures: 0, lastFailureAt: 0, openUntil: null }

  // Reset counter if outside window or after open period passed
  if (st.lastFailureAt && now - st.lastFailureAt > WINDOW_MS) {
    st.failures = 0
  }
  st.failures += 1
  st.lastFailureAt = now

  if (!st.openUntil && st.failures >= THRESHOLD) {
    st.openUntil = now + OPEN_MS
    try {
      console.log(JSON.stringify({ level: 'INFO', message: 'Circuit opened', id, platform, until: st.openUntil }))
    } catch {}
  }

  circuitBreakerCache.set(k, st)
}

export function recordSuccess(id: string, platform: Platform): void {
  const k = key(id, platform)
  const st: BreakerState = circuitBreakerCache.get(k) ?? { failures: 0, lastFailureAt: 0, openUntil: null }
  if (st.failures > 0 || st.openUntil) {
    try {
      console.log(JSON.stringify({ level: 'INFO', message: 'Circuit reset', id, platform }))
    } catch {}
  }
  circuitBreakerCache.delete(k)
}

export function nextAllowedAt(id: string, platform: Platform): number | null {
  const st = circuitBreakerCache.get(key(id, platform))
  return st?.openUntil ?? null
}

