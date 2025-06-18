/**
 * Build Deno deployment URL
 */
export function buildDenoUrl(subdomain: string, url: URL): string {
  if (subdomain === '') {
    return `https://ubq-fi.deno.dev${url.pathname}${url.search}`
  } else {
    return `https://${subdomain}-ubq-fi.deno.dev${url.pathname}${url.search}`
  }
}