import type { JsonPluginMap, PluginMapEntry } from './types'

const GENERATOR = 'ubq-fi-router'
const DEFAULT_CHANGEFREQ = 'daily'
const DEFAULT_LASTMOD = '2026-01-01'

export type SitemapApp = Readonly<{
  host: string
  priority?: number
  changefreq?: 'daily' | 'weekly' | 'monthly'
  lastmod?: string
}>

export type SitemapPlugin = Readonly<{
  host: string
  pluginName: string
  displayName: string
  description?: string
  repo: string
  priority?: number
  changefreq?: 'daily' | 'weekly' | 'monthly'
  lastmod?: string
}>

export type SitemapEntry = Readonly<{
  loc: string
  lastmod: string
  changefreq: 'daily' | 'weekly' | 'monthly'
  priority: number
}>

export type JsonSitemap = Readonly<{
  version: string
  generated: string
  generator: string
  total: number
  urls: SitemapEntry[]
}>

const DEFAULT_APPS: SitemapApp[] = [
  { host: 'ubq.fi', priority: 1 },
  { host: 'www.ubq.fi', priority: 0.9 },
  { host: 'pay.ubq.fi', priority: 0.9 },
  { host: 'work.ubq.fi', priority: 0.9 },
  { host: 'dao.ubq.fi', priority: 0.8 },
  { host: 'rpc.ubq.fi', priority: 0.7 },
]

const DEFAULT_PLUGINS: SitemapPlugin[] = [
  {
    host: 'os-command-config.ubq.fi',
    pluginName: 'command-config-main',
    displayName: 'Command Config',
    description: 'Command configuration plugin.',
    repo: 'ubiquity-os-marketplace/command-config',
    priority: 0.6,
  },
  {
    host: 'os-command-start-stop.ubq.fi',
    pluginName: 'command-start-stop-main',
    displayName: 'Command Start Stop',
    description: 'Start and stop command plugin.',
    repo: 'ubiquity-os-marketplace/command-start-stop',
    priority: 0.6,
  },
]

export function buildSitemapEntries(apps = DEFAULT_APPS, plugins = DEFAULT_PLUGINS): SitemapEntry[] {
  return [...apps.map(appToEntry), ...plugins.map(pluginToEntry)].sort((a, b) => a.loc.localeCompare(b.loc))
}

export function buildJsonSitemap(generated = new Date().toISOString()): JsonSitemap {
  const urls = buildSitemapEntries()
  return {
    version: '1',
    generated,
    generator: GENERATOR,
    total: urls.length,
    urls,
  }
}

export function buildJsonPluginMap(generated = new Date().toISOString()): JsonPluginMap {
  const plugins = DEFAULT_PLUGINS.map((plugin) => pluginToMapEntry(plugin))
  return {
    version: '1',
    generated,
    generator: GENERATOR,
    totalPlugins: plugins.length,
    plugins,
  }
}

export function renderSitemapXml(entries = buildSitemapEntries()): string {
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority.toFixed(1)}</priority>
  </url>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

function appToEntry(app: SitemapApp): SitemapEntry {
  return {
    loc: `https://${app.host}/`,
    lastmod: app.lastmod ?? DEFAULT_LASTMOD,
    changefreq: app.changefreq ?? DEFAULT_CHANGEFREQ,
    priority: app.priority ?? 0.8,
  }
}

function pluginToEntry(plugin: SitemapPlugin): SitemapEntry {
  return {
    loc: `https://${plugin.host}/`,
    lastmod: plugin.lastmod ?? DEFAULT_LASTMOD,
    changefreq: plugin.changefreq ?? 'weekly',
    priority: plugin.priority ?? 0.6,
  }
}

function pluginToMapEntry(plugin: SitemapPlugin): PluginMapEntry {
  return {
    url: `https://${plugin.host}/`,
    pluginName: plugin.pluginName,
    displayName: plugin.displayName,
    description: plugin.description ?? '',
    serviceType: 'plugin-deno',
    deployments: {
      main: {
        available: true,
        url: `https://${plugin.pluginName}.deno.dev`,
      },
      development: {
        available: true,
        url: `https://${plugin.pluginName.replace(/-main$/, '-development')}.deno.dev`,
      },
    },
    github: {
      repo: plugin.repo,
      url: `https://github.com/${plugin.repo}`,
    },
    priority: plugin.priority ?? 0.6,
    changefreq: plugin.changefreq ?? 'weekly',
    lastmod: plugin.lastmod ?? DEFAULT_LASTMOD,
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
