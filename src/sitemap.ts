import { buildDeno2AppSlug } from './utils/build-deno-url'

const GITHUB_API_BASE = 'https://api.github.com'
const ORG = 'ubiquity'
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300',
}

type GitHubRepo = Readonly<{
  name: string
  archived?: boolean
  disabled?: boolean
}>

export type RouteMapEntry = Readonly<{
  type: 'app' | 'plugin'
  name: string
  host: string
  url: string
  upstream: string
}>

export async function handleRouteMap(requestUrl: URL): Promise<Response | null> {
  if (requestUrl.pathname === '/sitemap.xml') {
    const entries = await buildRouteMap(requestUrl.origin)
    return new Response(toSitemapXml(entries), {
      headers: { ...CACHE_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' },
    })
  }

  if (requestUrl.pathname === '/routes.json' || requestUrl.pathname === '/sitemap.json') {
    const entries = await buildRouteMap(requestUrl.origin)
    return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2), {
      headers: { ...CACHE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  return null
}

export async function buildRouteMap(origin = 'https://ubq.fi'): Promise<RouteMapEntry[]> {
  const repos = await fetchOrgRepos()
  const apps = repos
    .filter((repo) => repo.name === 'ubq.fi' || repo.name.endsWith('.ubq.fi'))
    .map((repo) => {
      const subdomain = repo.name === 'ubq.fi' ? '' : repo.name.replace(/\.ubq\.fi$/, '')
      const host = subdomain ? `${subdomain}.ubq.fi` : 'ubq.fi'
      return {
        type: 'app' as const,
        name: repo.name,
        host,
        url: `${originForHost(origin, host)}/`,
        upstream: `https://${buildDeno2AppSlug(subdomain)}.ubiquity-dao.deno.net/`,
      }
    })

  const plugins = repos
    .filter((repo) => repo.name.startsWith('ubiquity-os-') || repo.name.startsWith('plugin-'))
    .map((repo) => {
      const plugin = repo.name.replace(/^ubiquity-os-/, '').replace(/^plugin-/, '')
      const host = `os-${plugin}.ubq.fi`
      return {
        type: 'plugin' as const,
        name: repo.name,
        host,
        url: `${originForHost(origin, host)}/`,
        upstream: `https://${plugin}-main.deno.dev/`,
      }
    })

  return [...apps, ...plugins].sort((a, b) => a.host.localeCompare(b.host))
}

async function fetchOrgRepos(): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = []
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${GITHUB_API_BASE}/orgs/${ORG}/repos?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ubq-fi-router',
      },
    })
    if (!response.ok) break
    const batch = await response.json() as GitHubRepo[]
    repos.push(...batch.filter((repo) => !repo.archived && !repo.disabled))
    if (batch.length < 100) break
  }
  return repos
}

function originForHost(origin: string, host: string): string {
  const url = new URL(origin)
  url.hostname = host
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function toSitemapXml(entries: RouteMapEntry[]): string {
  const urls = entries
    .map((entry) => `  <url>\n    <loc>${escapeXml(entry.url)}</loc>\n  </url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
