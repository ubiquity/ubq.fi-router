type Entry<T> = { value: T; expiresAt: number }

export class TTLCache<T> {
  private store = new Map<string, Entry<T>>()

  constructor(private defaultTtlMs: number) {}

  get(key: string): T | null {
    const e = this.store.get(key)
    if (!e) return null
    if (e.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }
    return e.value
  }

  set(key: string, value: T, ttlMs?: number) {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs)
    this.store.set(key, { value, expiresAt })
  }

  delete(key: string) {
    this.store.delete(key)
  }
}

// Shared caches in the isolate
export const routeServiceTypeCache = new TTLCache<string>(5 * 60 * 1000) // 5 minutes
export const routeResolutionCache = new TTLCache<string>(30 * 60 * 1000) // 30 minutes
export const lkgCache = new TTLCache<'deno' | 'pages'>(60 * 60 * 1000) // 1 hour

// Circuit breaker state cache (per host+platform)
export type BreakerState = {
  failures: number
  lastFailureAt: number
  openUntil: number | null
}

export const circuitBreakerCache = new TTLCache<BreakerState>(10 * 60 * 1000) // 10 minutes
