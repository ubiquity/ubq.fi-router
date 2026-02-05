/**
 * App Registry - Maps downstream routes/subdomains to their GitHub repositories
 * Supports both manual configuration and auto-detection
 */

import { GitHubRepoInfo, parseGitHubUrl, getLatestCommit, GitHubCommitInfo } from './github-api';
import { getPluginName } from './get-plugin-name'

export interface AppConfig {
  // Subdomain or route pattern (e.g., 'work.ubq.fi', 'pay.ubq.fi', 'os-*')
  pattern: string;
  // GitHub repository URL (optional for auto-detection)
  repoUrl?: string;
  // Enable auto-detection from GitHub API if repoUrl is not provided
  autoDetect?: boolean;
  // Skip footer injection for this app
  skipFooter?: boolean;
  // Custom footer text (default: short git hash)
  customText?: string;
}

export interface AppVersionInfo {
  pattern: string;
  repoInfo: GitHubRepoInfo | null;
  commit: GitHubCommitInfo | null;
  lastUpdated: number;
  skipFooter: boolean;
  customText?: string;
}

export interface VersionResult {
  commitHash: string;
  repoUrl: string;
  pattern: string;
  fromCache: boolean;
  customText?: string;
}

// Known downstream applications registry
const DEFAULT_APPS: AppConfig[] = [
  {
    pattern: 'work.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/work.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'pay.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/pay.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'ai.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/ai.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'demo.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/demo.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'xp.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/xp.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'uusd.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/uusd.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'stake.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/stake.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'safe.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/safe.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'card.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/card.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'permit2-allowance.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/permit2-allowance.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'partner.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/partner.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'onboard.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/onboard.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'notifications.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/notifications.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'leaderboard.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/leaderboard.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'keygen.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/keygen.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'health.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/health.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'audit.ubq.fi',
    repoUrl: 'https://github.com/ubiquity/audit.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'ubq.fi',
    repoUrl: 'https://github.com/ubiquity/ubq.fi',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-xp.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-xp/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-xp-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-xp/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-xp-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-xp/tree/development',
    autoDetect: true,
  },
  {
    pattern: 'os-text-conversation-rewards.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/text-conversation-rewards/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-text-conversation-rewards-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/text-conversation-rewards/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-text-conversation-rewards-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/text-conversation-rewards/tree/development',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-task-matcher.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-task-matcher/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-task-matcher-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-task-matcher/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-task-matcher-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-task-matcher/tree/development',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-spec-rewriter.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-spec-rewriter/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-spec-rewriter-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-spec-rewriter/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-spec-rewriter-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-spec-rewriter/tree/development',
    autoDetect: true,
  },
  // text-vector-embeddings
  {
    pattern: 'os-text-vector-embeddings.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/text-vector-embeddings/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-text-vector-embeddings-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/text-vector-embeddings/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-text-vector-embeddings-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/text-vector-embeddings/tree/development',
    autoDetect: true,
  },

  // daemon-pricing
  {
    pattern: 'os-daemon-pricing.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-pricing/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-pricing-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-pricing/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-pricing-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-pricing/tree/development',
    autoDetect: true,
  },

  // command-config
  {
    pattern: 'os-command-config.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-config/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-config-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-config/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-config-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-config/tree/development',
    autoDetect: true,
  },

  // daemon-planner
  {
    pattern: 'os-daemon-planner.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-planner/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-planner-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-planner/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-planner-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-planner/tree/development',
    autoDetect: true,
  },

  // daemon-merging
  {
    pattern: 'os-daemon-merging.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-merging/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-merging-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-merging/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-merging-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-merging/tree/development',
    autoDetect: true,
  },

  // command-wallet
  {
    pattern: 'os-command-wallet.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-wallet/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-wallet-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-wallet/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-wallet-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-wallet/tree/development',
    autoDetect: true,
  },

  // daemon-disqualifier
  {
    pattern: 'os-daemon-disqualifier.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-disqualifier/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-disqualifier-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-disqualifier/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-daemon-disqualifier-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/daemon-disqualifier/tree/development',
    autoDetect: true,
  },

  // command-start-stop
  {
    pattern: 'os-command-start-stop.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-start-stop/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-start-stop-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-start-stop/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-start-stop-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-start-stop/tree/development',
    autoDetect: true,
  },

  // command-query
  {
    pattern: 'os-command-query.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-query/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-query-main.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-query/tree/main',
    autoDetect: true,
  },
  {
    pattern: 'os-command-query-development.ubq.fi',
    repoUrl: 'https://github.com/ubiquity-os-marketplace/command-query/tree/development',
    autoDetect: true,
  },

  // Plugin patterns (auto-detected from subdomain)
  {
    pattern: 'os-*.ubq.fi',
    autoDetect: true,
  },
  {
    pattern: '*.ubq.fi',
    skipFooter: true, // Unknown subdomains skip by default
  },
];

// Registry state
const appVersions = new Map<string, AppVersionInfo>();
let registryInitialized = false;

/**
 * Initialize the app registry with default apps
 */
export function initializeRegistry(apps: AppConfig[] = DEFAULT_APPS): void {
  if (registryInitialized) {
    return;
  }

  for (const app of apps) {
    const repoInfo = app.repoUrl ? parseGitHubUrl(app.repoUrl) : null;

    appVersions.set(app.pattern, {
      pattern: app.pattern,
      repoInfo,
      commit: null,
      lastUpdated: 0,
      skipFooter: app.skipFooter ?? false,
      customText: app.customText,
    });
  }

  registryInitialized = true;
}

/**
 * Register a new app or update existing configuration
 */
export function registerApp(config: AppConfig): void {
  const repoInfo = config.repoUrl ? parseGitHubUrl(config.repoUrl) : null;

  appVersions.set(config.pattern, {
    pattern: config.pattern,
    repoInfo,
    commit: null,
    lastUpdated: 0,
    skipFooter: config.skipFooter ?? false,
    customText: config.customText,
  });
}

/**
 * Get version info for a given hostname
 */
export async function getAppVersion(hostname: string): Promise<VersionResult | null> {
  // Ensure registry is initialized
  if (!registryInitialized) {
    initializeRegistry();
  }

  // Try to match the hostname against registered patterns
  const matchedPattern = matchPattern(hostname);

  if (!matchedPattern) {
    return null;
  }

  const appInfo = appVersions.get(matchedPattern);
  if (!appInfo) {
    return null;
  }

  // Skip footer if configured
  if (appInfo.skipFooter) {
    return null;
  }

  // Try to get version info
  if (appInfo.repoInfo) {
    // Check if we need to fetch fresh data (cache expired or no data)
    const now = Date.now();
    const cacheExpiry = appInfo.lastUpdated + 3600000; // 1 hour cache

    if (!appInfo.commit || now > cacheExpiry) {
      // Fetch latest commit from GitHub
      const commit = await getLatestCommit(appInfo.repoInfo);

      if (commit) {
        appInfo.commit = commit;
        appInfo.lastUpdated = now;
      }
    }

    if (appInfo.commit && appInfo.repoInfo) {
      const repoUrl = `https://github.com/${appInfo.repoInfo.owner}/${appInfo.repoInfo.repo}`;
      const fromCache = now - appInfo.lastUpdated < 60000; // Cached within last minute

      return {
        commitHash: appInfo.commit.sha,
        repoUrl,
        pattern: matchedPattern,
        fromCache,
        customText: appInfo.customText,
      };
    }
  }

// Auto-detection for plugin patterns
  if (matchedPattern === 'os-*.ubq.fi' || hostname.startsWith('os-')) {
    try {
      const pluginName = getPluginName(hostname)
      return await detectPluginVersion(pluginName, hostname)
    } catch (error) {
      // Not a plugin domain, skip auto-detection
      return null
    }
  }

  return null;
}

/**
 * Match a hostname against registered patterns
 */
function matchPattern(hostname: string): string | null {
  // Exact match first
  if (appVersions.has(hostname)) {
    return hostname;
  }

  // Check wildcard patterns
  for (const pattern of appVersions.keys()) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '[^.]+') + '$');
      if (regex.test(hostname)) {
        return pattern;
      }
    }
  }

  return null;
}


/**
 * Attempt to auto-detect a plugin's version info with parallel lookups and negative caching
 */
const NEGATIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const REPO_TIMEOUT = 5000; // 5 seconds per repo

async function detectPluginVersion(pluginName: string, hostname: string): Promise<VersionResult | null> {
  // Check negative cache first
  const cached = appVersions.get(hostname);
  if (cached && cached.commit === null) {
    const now = Date.now();
    if (now - cached.lastUpdated < NEGATIVE_CACHE_TTL) {
      return null; // Still within negative cache TTL
    }
  }

  // Try common plugin repository patterns in parallel
  const possibleRepos = [
    `https://github.com/ubiquity/${pluginName}`,
    `https://github.com/ubiquity-os/${pluginName}`,
    `https://github.com/ubiquity-os-marketplace/${pluginName}`,
  ];

  // Create parallel fetch promises with individual timeouts
  const fetchPromises = possibleRepos.map(async (repoUrl) => {
    const repoInfo = parseGitHubUrl(repoUrl);
    if (!repoInfo) return null;

    try {
      const commit = await getLatestCommit(repoInfo, { timeout: REPO_TIMEOUT });
      return commit ? { commit, repoInfo, repoUrl } : null;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(fetchPromises);
  const successfulResult = results.find(r => r !== null);

  if (successfulResult) {
    // Register this plugin for future requests
    registerApp({
      pattern: hostname,
      repoUrl: successfulResult.repoUrl,
      autoDetect: false,
    });

    return {
      commitHash: successfulResult.commit.sha,
      repoUrl: successfulResult.repoUrl,
      pattern: hostname,
      fromCache: false,
      customText: appVersions.get(hostname)?.customText,
    };
  }

  // Cache negative result for future requests
  appVersions.set(hostname, {
    pattern: hostname,
    repoInfo: null,
    commit: null,
    lastUpdated: Date.now(),
    skipFooter: false,
  });

  return null;
}

/**
 * Get all registered apps (for debugging/admin)
 */
export function getRegisteredApps(): Array<{ pattern: string; hasCommit: boolean; skipFooter: boolean }> {
  if (!registryInitialized) {
    initializeRegistry();
  }

  const result: Array<{ pattern: string; hasCommit: boolean; skipFooter: boolean }> = [];

  for (const [pattern, info] of appVersions.entries()) {
    result.push({
      pattern,
      hasCommit: info.commit !== null,
      skipFooter: info.skipFooter,
    });
  }

  return result;
}

/**
 * Clear version cache for all apps
 */
export function clearAllCaches(): void {
  for (const appInfo of appVersions.values()) {
    appInfo.commit = null;
    appInfo.lastUpdated = 0;
  }
}

/**
 * Preload version info for known apps
 */
export async function preloadVersions(): Promise<void> {
  if (!registryInitialized) {
    initializeRegistry();
  }

  const promises: Promise<void>[] = [];

  for (const [pattern, appInfo] of appVersions.entries()) {
    if (appInfo.skipFooter) continue;
    if (!appInfo.repoInfo) continue;

    promises.push(
      getLatestCommit(appInfo.repoInfo).then((commit) => {
        if (commit) {
          appInfo.commit = commit;
          appInfo.lastUpdated = Date.now();
        }
      }).catch(() => {
        // Silently fail for preloading
      })
    );
  }

  await Promise.all(promises);
}

/**
 * Add a custom app configuration (for admin use)
 */
export function addCustomApp(
  pattern: string,
  repoUrl: string,
  options: { skipFooter?: boolean; customText?: string } = {}
): void {
  registerApp({
    pattern,
    repoUrl,
    autoDetect: false,
    skipFooter: options.skipFooter,
    customText: options.customText,
  });
}