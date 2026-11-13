import { getHealthSnapshot, type HealthDashboardEnv } from './health-dashboard/api'
import { discoverAppMap, discoverPluginMap, mapStatus, type AppRoute, type MapEntry } from './plugin-map-discovery'

function escapeXml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
  return value
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[&<>"']/g, (character) => entities[character])
}

/** CI timestamps are not content modification dates, so do not emit lastmod. */
export function generateSitemap(entries: readonly MapEntry[]): string {
  const urls = entries.map((entry) => {
    const checks = entry.checks.map((check) => `<infra:check>${Object.entries(check)
      .map(([key, value]) => `<infra:${key}>${escapeXml(String(value))}</infra:${key}>`).join('')}</infra:check>`).join('')
    return `<url><loc>${escapeXml(entry.url)}</loc><infra:name>${escapeXml(entry.name)}</infra:name>` +
      `<infra:status>${entry.status}</infra:status>` +
      (entry.repository ? `<infra:repository>${escapeXml(entry.repository)}</infra:repository>` : '') + checks + '</url>'
  }).join('\n')
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:infra="https://ubq.fi/ns/infrastructure">\n' +
    urls + '\n</urlset>'
}

/** Only the apex inventory endpoints are owned here; app paths continue upstream. */
export async function handleSitemap(
  request: Request,
  env: HealthDashboardEnv,
  apps: () => AppRoute[],
): Promise<Response | null> {
  const url = new URL(request.url)
  const match = /^\/(sitemap|plugin-map)\.(xml|json)$/.exec(url.pathname)
  if (url.hostname !== 'ubq.fi' || !match) return null
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD, OPTIONS')
    return new Response('Method not allowed', { status: 405, headers })
  }
  const health = await getHealthSnapshot(env)
  const entries = match[1] === 'sitemap' ? discoverAppMap(health, apps()) : discoverPluginMap(health)
  const map = {
    kind: match[1] === 'sitemap' ? 'apps' : 'plugins',
    status: mapStatus(entries),
    updatedAt: health.updatedAt,
    entries,
    ...(health.error ? { error: health.error } : {}),
  }
  const isJson = match[2] === 'json'
  headers.set('Content-Type', isJson ? 'application/json; charset=utf-8' : 'application/xml; charset=utf-8')
  const body = request.method === 'HEAD' ? null : isJson ? JSON.stringify(map) : health.error
    ? `<?xml version="1.0" encoding="UTF-8"?><error>${escapeXml(health.error)}</error>`
    : generateSitemap(entries)
  return new Response(body, { status: health.error ? 503 : 200, headers })
}
