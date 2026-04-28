const DENO_ORG_SLUG = 'ubiquity-dao'
const DENO2_POSITIVE_CACHE_SECONDS = 300
const DENO2_NEGATIVE_CACHE_SECONDS = 60
const DENO2_PROBE_TIMEOUT_MS = 1500

export const DENO_CLASSIC_SUNSET_DATE = '2026-07-20'
export const DENO_CLASSIC_SUNSET_HTTP_DATE = 'Mon, 20 Jul 2026 00:00:00 GMT'
export const DENO_CLASSIC_MIGRATION_URL = 'https://docs.deno.com/deploy/migration_guide/'
export const DENO_CLASSIC_FALLBACK_WARNING =
  `Deno Deploy Classic fallback in use; migrate this service to Deno Deploy before ${DENO_CLASSIC_SUNSET_DATE}.`

export type DenoRouteTarget = Readonly<{
  url: string
  kind: 'deno2' | 'classic'
  deno2Url: string
  classicUrl: string
  fallbackReason?: 'deno2_deployment_not_found' | 'deno2_probe_failed'
}>

type ProbeResult = true | false | null
type CacheLike = Pick<Cache, 'match' | 'put'>
type ProbeFetch = (input: string, init?: RequestInit) => Promise<Response>

export type ResolveDenoUrlOptions = Readonly<{
  cache?: CacheLike | null
  fetch?: ProbeFetch
  probeTimeoutMs?: number
}>

export function buildDeno2AppSlug(subdomain: string): string {
  return subdomain === '' ? 'ubq-fi' : `${subdomain}-ubq-fi`
}

export function buildDeno2Url(subdomain: string, url: URL): string {
  return `https://${buildDeno2AppSlug(subdomain)}.${DENO_ORG_SLUG}.deno.net${url.pathname}${url.search}`
}

export function buildClassicDenoUrl(subdomain: string, url: URL): string {
  if (subdomain === '') {
    return `https://ubq-fi.deno.dev${url.pathname}${url.search}`
  }
  return `https://${subdomain}-ubq-fi.deno.dev${url.pathname}${url.search}`
}

export const buildDenoUrl = buildClassicDenoUrl

export async function resolveDenoUrl(
  subdomain: string,
  url: URL,
  options: ResolveDenoUrlOptions = {},
): Promise<DenoRouteTarget> {
  const deno2Url = buildDeno2Url(subdomain, url)
  const classicUrl = buildClassicDenoUrl(subdomain, url)
  const deno2Exists = await deno2DeploymentExists(subdomain, options)

  if (deno2Exists) {
    return { url: deno2Url, kind: 'deno2', deno2Url, classicUrl }
  }

  return {
    url: classicUrl,
    kind: 'classic',
    deno2Url,
    classicUrl,
    fallbackReason: deno2Exists === false ? 'deno2_deployment_not_found' : 'deno2_probe_failed',
  }
}

export function isDenoDeploymentNotFound(headers: Headers): boolean {
  const raw = headers.get('x-deno-error')
  if (!raw) return false

  try {
    const parsed = JSON.parse(raw) as { code?: unknown }
    return parsed.code === 'DEPLOYMENT_NOT_FOUND'
  } catch {
    return raw.includes('DEPLOYMENT_NOT_FOUND')
  }
}

async function deno2DeploymentExists(
  subdomain: string,
  options: ResolveDenoUrlOptions,
): Promise<ProbeResult> {
  const appSlug = buildDeno2AppSlug(subdomain)
  const cache = 'cache' in options ? options.cache ?? null : getDefaultCache()
  const cached = await readProbeCache(cache, appSlug)
  if (cached !== null) return cached

  const result = await probeDeno2Deployment(appSlug, options)
  if (result !== null) {
    await writeProbeCache(cache, appSlug, result)
  }
  return result
}

async function probeDeno2Deployment(
  appSlug: string,
  options: ResolveDenoUrlOptions,
): Promise<ProbeResult> {
  const fetcher = options.fetch ?? fetch
  const probeUrl = `https://${appSlug}.${DENO_ORG_SLUG}.deno.net/__ubq_route_probe__`

  try {
    const res = await fetcher(probeUrl, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.probeTimeoutMs ?? DENO2_PROBE_TIMEOUT_MS),
    })

    try {
      await res.body?.cancel()
    } catch {}

    return !isDenoDeploymentNotFound(res.headers)
  } catch {
    return null
  }
}

async function readProbeCache(cache: CacheLike | null, appSlug: string): Promise<ProbeResult> {
  if (!cache) return null

  try {
    const cached = await cache.match(probeCacheKey(appSlug))
    if (!cached) return null
    const value = await cached.text()
    if (value === 'exists') return true
    if (value === 'missing') return false
    return null
  } catch {
    return null
  }
}

async function writeProbeCache(cache: CacheLike | null, appSlug: string, exists: boolean): Promise<void> {
  if (!cache) return

  try {
    await cache.put(
      probeCacheKey(appSlug),
      new Response(exists ? 'exists' : 'missing', {
        headers: {
          'Cache-Control': `public, max-age=${
            exists ? DENO2_POSITIVE_CACHE_SECONDS : DENO2_NEGATIVE_CACHE_SECONDS
          }`,
        },
      }),
    )
  } catch {}
}

function probeCacheKey(appSlug: string): Request {
  return new Request(`https://router.ubq.fi/__deno2_route_probe_cache__/${appSlug}`)
}

function getDefaultCache(): CacheLike | null {
  try {
    if (typeof caches === 'undefined') return null
    return (caches as unknown as { default?: CacheLike }).default ?? null
  } catch {
    return null
  }
}
