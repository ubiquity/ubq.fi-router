import { buildDeno2AppSlug, buildDeno2Url } from './build-deno-url'
import { getPluginName } from './get-plugin-name'

export interface AppEntry {
  name: string
  subdomain: string
  hostname: string
  url: string
  targetDenoUrl: string
  description: string
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority: number
}

export interface PluginEntry {
  name: string
  hostname: string
  url: string
  targetDenoUrl: string
  pluginSlug: string
  description: string
  type: 'kernel' | 'command' | 'daemon' | 'reward' | 'agent'
}

export interface SitemapJsonPayload {
  schemaVersion: string
  generatedAt: string
  totalEntries: number
  domain: string
  apps: AppEntry[]
  plugins: PluginEntry[]
}

export interface PluginsJsonPayload {
  schemaVersion: string
  generatedAt: string
  totalPlugins: number
  plugins: PluginEntry[]
}

export const KNOWN_APPS: readonly Omit<AppEntry, 'url' | 'targetDenoUrl'>[] = [
  {
    name: 'Ubiquity Root Portal',
    subdomain: '',
    hostname: 'ubq.fi',
    description: 'Main landing page and entry portal for Ubiquity ecosystem',
    changefreq: 'daily',
    priority: 1.0,
  },
  {
    name: 'Ubiquity Work (Task Hub)',
    subdomain: 'work',
    hostname: 'work.ubq.fi',
    description: 'Bounty hunter and developer task exploration platform',
    changefreq: 'hourly',
    priority: 0.9,
  },
  {
    name: 'Ubiquity Pay',
    subdomain: 'pay',
    hostname: 'pay.ubq.fi',
    description: 'Automated crypto payment claim and permit generation portal',
    changefreq: 'daily',
    priority: 0.8,
  },
  {
    name: 'Ubiquity AI Assistant',
    subdomain: 'ai',
    hostname: 'ai.ubq.fi',
    description: 'AI inference, code review assistance and automated agent intelligence',
    changefreq: 'weekly',
    priority: 0.8,
  },
  {
    name: 'Ubiquity DAO Governance',
    subdomain: 'dao',
    hostname: 'dao.ubq.fi',
    description: 'Decentralized governance, proposal submission and voting system',
    changefreq: 'weekly',
    priority: 0.7,
  },
  {
    name: 'Ubiquity RPC Proxy',
    subdomain: 'rpc',
    hostname: 'rpc.ubq.fi',
    description: 'Multi-chain JSON-RPC caching proxy gateway',
    changefreq: 'monthly',
    priority: 0.6,
  },
]

export const KNOWN_PLUGINS: readonly Omit<PluginEntry, 'url' | 'targetDenoUrl'>[] = [
  {
    name: 'Command Start / Stop',
    hostname: 'os-command-start-stop.ubq.fi',
    pluginSlug: 'command-start-stop-main',
    description: 'Handles /start and /stop issue assignment commands',
    type: 'command',
  },
  {
    name: 'Text Conversation Rewards',
    hostname: 'os-text-conversation-rewards.ubq.fi',
    pluginSlug: 'text-conversation-rewards-main',
    description: 'Calculates performance incentives and contributor comment rewards',
    type: 'reward',
  },
  {
    name: 'Daemon Pricing',
    hostname: 'os-daemon-pricing.ubq.fi',
    pluginSlug: 'daemon-pricing-main',
    description: 'Calculates dynamic baseline task pricing and difficulty ratings',
    type: 'daemon',
  },
  {
    name: 'Command Wallet',
    hostname: 'os-command-wallet.ubq.fi',
    pluginSlug: 'command-wallet-main',
    description: 'Allows contributors to register payout addresses via /wallet',
    type: 'command',
  },
  {
    name: 'Pull Request Review Agent',
    hostname: 'os-pull-request-review-agent.ubq.fi',
    pluginSlug: 'pull-request-review-agent-main',
    description: 'Automated AI code review and pull request validation agent',
    type: 'agent',
  },
  {
    name: 'UbiquityOS Kernel',
    hostname: 'os-kernel.ubq.fi',
    pluginSlug: 'kernel-main',
    description: 'Central event router and plugin orchestration kernel',
    type: 'kernel',
  },
]

export function getFullAppList(): AppEntry[] {
  const dummyUrl = new URL('https://ubq.fi/')
  return KNOWN_APPS.map((app) => ({
    ...app,
    url: `https://${app.hostname}`,
    targetDenoUrl: app.subdomain === 'rpc' 
      ? 'https://rpc.ubq.fi' 
      : buildDeno2Url(app.subdomain, dummyUrl),
  }))
}

export function getFullPluginList(): PluginEntry[] {
  return KNOWN_PLUGINS.map((plugin) => {
    const slug = getPluginName(plugin.hostname)
    return {
      ...plugin,
      url: `https://${plugin.hostname}`,
      targetDenoUrl: `https://${slug}.deno.dev/`,
    }
  })
}

export function generateSitemapXml(timestamp?: string): string {
  const apps = getFullAppList()
  const plugins = getFullPluginList()
  const lastmod = (timestamp || new Date().toISOString()).split('T')[0]

  const appUrls = apps.map((a) => `  <url>
    <loc>${a.url}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${a.changefreq}</changefreq>
    <priority>${a.priority.toFixed(1)}</priority>
  </url>`).join('\n')

  const pluginUrls = plugins.map((p) => `  <url>
    <loc>${p.url}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${appUrls}
${pluginUrls}
</urlset>`
}

export function generateSitemapJson(timestamp?: string): SitemapJsonPayload {
  const apps = getFullAppList()
  const plugins = getFullPluginList()
  const now = timestamp || new Date().toISOString()

  return {
    schemaVersion: '1.0.0',
    generatedAt: now,
    totalEntries: apps.length + plugins.length,
    domain: 'ubq.fi',
    apps,
    plugins,
  }
}

export function generatePluginsJson(timestamp?: string): PluginsJsonPayload {
  const plugins = getFullPluginList()
  const now = timestamp || new Date().toISOString()

  return {
    schemaVersion: '1.0.0',
    generatedAt: now,
    totalPlugins: plugins.length,
    plugins,
  }
}
