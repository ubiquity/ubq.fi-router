/**
 * Extract subdomain key for caching
 * Examples:
 * - ubq.fi -> ""
 * - pay.ubq.fi -> "pay"
 * - beta.pay.ubq.fi -> "beta.pay"
 * - os-command-config-main.ubq.fi -> "os-command-config-main"
 */
export function getSubdomainKey(hostname: string): string {
  const parts = hostname.split('.')

  if (parts.length === 2) {
    // Root domain: ubq.fi
    return ""
  } else if (parts.length === 3) {
    // Standard subdomain: pay.ubq.fi or plugin domain: os-*.ubq.fi
    return parts[0]
  } else if (parts.length === 4) {
    // Branch subdomain: beta.pay.ubq.fi
    return `${parts[0]}.${parts[1]}`
  }

  throw new Error('Invalid domain format')
}

/**
 * Check if a hostname is a plugin domain (os-*.ubq.fi)
 */
export function isPluginDomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length === 3 && parts[0].startsWith('os-') && parts[1] === 'ubq' && parts[2] === 'fi'
}

/**
 * Extract plugin name from plugin domain
 * Examples:
 * - os-command-config-main.ubq.fi -> "command-config-main"
 * - os-command-config.ubq.fi -> "command-config-main" (aliased to main)
 */
export function getPluginName(hostname: string): string {
  if (!isPluginDomain(hostname)) {
    throw new Error('Not a plugin domain')
  }
  // Remove 'os-' prefix to get base plugin name
  const baseName = hostname.split('.')[0].substring(3)

  // List of common deployment suffixes
  const deploymentSuffixes = ['main', 'dev', 'development', 'staging', 'stage', 'test', 'testing', 'prod', 'production', 'preview', 'beta', 'alpha']

  // Check if the base name ends with a deployment suffix
  const endsWithDeploymentSuffix = deploymentSuffixes.some(suffix => baseName.endsWith(`-${suffix}`))

  // Check for feature/fix branches (pattern: plugin-feature-name or plugin-fix-name)
  const hasFeatureBranch = /-(?:feature|fix|hotfix)-.+$/.test(baseName)

  if (!endsWithDeploymentSuffix && !hasFeatureBranch) {
    // No deployment suffix detected, append -main for production alias
    return `${baseName}-main`
  }

  // Has deployment suffix or feature branch, use as-is
  return baseName
}

/**
 * Build Deno Deploy URL from subdomain pattern
 */
export function buildDenoUrl(subdomain: string, url: URL): string {
  if (subdomain === "") {
    // Root domain: ubq.fi -> ubq-fi.deno.dev
    return `https://ubq-fi.deno.dev${url.pathname}${url.search}`
  } else {
    // Subdomain: pay.ubq.fi -> pay-ubq-fi.deno.dev
    // Branch: beta.pay.ubq.fi -> beta-pay-ubq-fi.deno.dev
    const denoSubdomain = subdomain.replace(/\./g, '-')
    return `https://${denoSubdomain}-ubq-fi.deno.dev${url.pathname}${url.search}`
  }
}

/**
 * Build Cloudflare Pages URL from subdomain pattern
 */
export function buildPagesUrl(subdomain: string, url: URL): string {
  if (subdomain === "") {
    // Root domain: ubq.fi -> ubq-fi.pages.dev
    return `https://ubq-fi.pages.dev${url.pathname}${url.search}`
  } else {
    // Subdomain: pay.ubq.fi -> pay-ubq-fi.pages.dev
    // Branch: beta.pay.ubq.fi -> beta.pay-ubq-fi.pages.dev
    return `https://${subdomain}-ubq-fi.pages.dev${url.pathname}${url.search}`
  }
}

/**
 * Build plugin URL from plugin domain
 * Example: os-command-config-main.ubq.fi -> https://command-config-main.deno.dev
 */
export function buildPluginUrl(hostname: string, url: URL): string {
  const pluginName = getPluginName(hostname)
  return `https://${pluginName}.deno.dev${url.pathname}${url.search}`
}
