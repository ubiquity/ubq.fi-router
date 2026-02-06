/**
 * Static configuration for services and plugins
 * Used as fallback when GitHub API is unavailable
 */

export interface AppConfig {
  subdomain: string
  github: string
}

export interface PluginConfig {
  name: string
  github: string
}

/**
 * Known services (ubiquity org repos that end with .ubq.fi)
 */
export const STATIC_SERVICES: AppConfig[] = [
  { subdomain: '', github: 'ubiquity/ubq.fi' },
  { subdomain: 'work', github: 'ubiquity/work.ubq.fi' },
  { subdomain: 'pay', github: 'ubiquity/pay.ubq.fi' },
  { subdomain: 'ai', github: 'ubiquity/ai.ubq.fi' },
  { subdomain: 'demo', github: 'ubiquity/demo.ubq.fi' },
  { subdomain: 'xp', github: 'ubiquity/xp.ubq.fi' },
  { subdomain: 'uusd', github: 'ubiquity/uusd.ubq.fi' },
  { subdomain: 'stake', github: 'ubiquity/stake.ubq.fi' },
  { subdomain: 'safe', github: 'ubiquity/safe.ubq.fi' },
  { subdomain: 'card', github: 'ubiquity/card.ubq.fi' },
  { subdomain: 'permit2-allowance', github: 'ubiquity/permit2-allowance.ubq.fi' },
  { subdomain: 'partner', github: 'ubiquity/partner.ubq.fi' },
  { subdomain: 'onboard', github: 'ubiquity/onboard.ubq.fi' },
  { subdomain: 'notifications', github: 'ubiquity/notifications.ubq.fi' },
  { subdomain: 'leaderboard', github: 'ubiquity/leaderboard.ubq.fi' },
  { subdomain: 'keygen', github: 'ubiquity/keygen.ubq.fi' },
  { subdomain: 'health', github: 'ubiquity/health.ubq.fi' },
  { subdomain: 'audit', github: 'ubiquity/audit.ubq.fi' },
]

/**
 * Known plugins (ubiquity-os-marketplace org repos)
 */
export const STATIC_PLUGINS: PluginConfig[] = [
  { name: 'daemon-xp', github: 'ubiquity-os-marketplace/daemon-xp' },
  { name: 'daemon-xp-main', github: 'ubiquity-os-marketplace/daemon-xp/tree/main' },
  { name: 'daemon-xp-development', github: 'ubiquity-os-marketplace/daemon-xp/tree/development' },
  { name: 'text-conversation-rewards', github: 'ubiquity-os-marketplace/text-conversation-rewards' },
  { name: 'text-conversation-rewards-main', github: 'ubiquity-os-marketplace/text-conversation-rewards/tree/main' },
  { name: 'text-conversation-rewards-development', github: 'ubiquity-os-marketplace/text-conversation-rewards/tree/development' },
  { name: 'daemon-task-matcher', github: 'ubiquity-os-marketplace/daemon-task-matcher' },
  { name: 'daemon-task-matcher-main', github: 'ubiquity-os-marketplace/daemon-task-matcher/tree/main' },
  { name: 'daemon-task-matcher-development', github: 'ubiquity-os-marketplace/daemon-task-matcher/tree/development' },
  { name: 'daemon-spec-rewriter', github: 'ubiquity-os-marketplace/daemon-spec-rewriter' },
  { name: 'daemon-spec-rewriter-main', github: 'ubiquity-os-marketplace/daemon-spec-rewriter/tree/main' },
  { name: 'daemon-spec-rewriter-development', github: 'ubiquity-os-marketplace/daemon-spec-rewriter/tree/development' },
  { name: 'text-vector-embeddings', github: 'ubiquity-os-marketplace/text-vector-embeddings' },
  { name: 'text-vector-embeddings-main', github: 'ubiquity-os-marketplace/text-vector-embeddings/tree/main' },
  { name: 'text-vector-embeddings-development', github: 'ubiquity-os-marketplace/text-vector-embeddings/tree/development' },
  { name: 'daemon-pricing', github: 'ubiquity-os-marketplace/daemon-pricing' },
  { name: 'daemon-pricing-main', github: 'ubiquity-os-marketplace/daemon-pricing/tree/main' },
  { name: 'daemon-pricing-development', github: 'ubiquity-os-marketplace/daemon-pricing/tree/development' },
  { name: 'command-config', github: 'ubiquity-os-marketplace/command-config' },
  { name: 'command-config-main', github: 'ubiquity-os-marketplace/command-config/tree/main' },
  { name: 'command-config-development', github: 'ubiquity-os-marketplace/command-config/tree/development' },
  { name: 'daemon-planner', github: 'ubiquity-os-marketplace/daemon-planner' },
  { name: 'daemon-planner-main', github: 'ubiquity-os-marketplace/daemon-planner/tree/main' },
  { name: 'daemon-planner-development', github: 'ubiquity-os-marketplace/daemon-planner/tree/development' },
  { name: 'daemon-merging', github: 'ubiquity-os-marketplace/daemon-merging' },
  { name: 'daemon-merging-main', github: 'ubiquity-os-marketplace/daemon-merging/tree/main' },
  { name: 'daemon-merging-development', github: 'ubiquity-os-marketplace/daemon-merging/tree/development' },
  { name: 'command-wallet', github: 'ubiquity-os-marketplace/command-wallet' },
  { name: 'command-wallet-main', github: 'ubiquity-os-marketplace/command-wallet/tree/main' },
  { name: 'command-wallet-development', github: 'ubiquity-os-marketplace/command-wallet/tree/development' },
  { name: 'daemon-disqualifier', github: 'ubiquity-os-marketplace/daemon-disqualifier' },
  { name: 'daemon-disqualifier-main', github: 'ubiquity-os-marketplace/daemon-disqualifier/tree/main' },
  { name: 'daemon-disqualifier-development', github: 'ubiquity-os-marketplace/daemon-disqualifier/tree/development' },
  { name: 'command-start-stop', github: 'ubiquity-os-marketplace/command-start-stop' },
  { name: 'command-start-stop-main', github: 'ubiquity-os-marketplace/command-start-stop/tree/main' },
  { name: 'command-start-stop-development', github: 'ubiquity-os-marketplace/command-start-stop/tree/development' },
  { name: 'command-query', github: 'ubiquity-os-marketplace/command-query' },
  { name: 'command-query-main', github: 'ubiquity-os-marketplace/command-query/tree/main' },
  { name: 'command-query-development', github: 'ubiquity-os-marketplace/command-query/tree/development' },
]

/**
 * Get service subdomains from static config
 */
export function getServiceSubdomains(): string[] {
  return STATIC_SERVICES.map(service => service.subdomain)
}

/**
 * Get plugin names from static config
 */
export function getPluginNames(): string[] {
  return STATIC_PLUGINS.map(plugin => plugin.name)
}
