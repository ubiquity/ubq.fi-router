/**
 * Build Pages deployment URL
 */
export function buildPagesUrl(subdomain: string, url: URL): string {
  if (subdomain === '') {
    return `https://ubq-fi.pages.dev${url.pathname}${url.search}`
  } else {
    return `https://${subdomain}-ubq-fi.pages.dev${url.pathname}${url.search}`
  }
}