/**
 * Extract subdomain key for caching
 * Examples:
 * - ubq.fi -> ""
 * - pay.ubq.fi -> "pay"
 * - beta.pay.ubq.fi -> "beta.pay"
 */
export function getSubdomainKey(hostname: string): string {
  const parts = hostname.split('.')

  if (parts.length === 2) {
    // Root domain: ubq.fi
    return ""
  } else if (parts.length === 3) {
    // Standard subdomain: pay.ubq.fi
    return parts[0]
  } else if (parts.length === 4) {
    // Branch subdomain: beta.pay.ubq.fi
    return `${parts[0]}.${parts[1]}`
  }

  throw new Error('Invalid domain format')
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
    const pagesSubdomain = subdomain.replace(/\./g, '.')
    return `https://${pagesSubdomain}-ubq-fi.pages.dev${url.pathname}${url.search}`
  }
}
