const DENO_ORG_SLUG = 'ubiquity-dao'

export type DenoRouteTarget = Readonly<{
  url: string
  kind: 'deno2'
  deno2Url: string
}>

export function buildDeno2AppSlug(subdomain: string): string {
  return subdomain === '' ? 'ubq-fi' : `${subdomain}-ubq-fi`
}

export function buildDeno2Url(subdomain: string, url: URL): string {
  return `https://${buildDeno2AppSlug(subdomain)}.${DENO_ORG_SLUG}.deno.net${url.pathname}${url.search}`
}

export const buildDenoUrl = buildDeno2Url

export async function resolveDenoUrl(subdomain: string, url: URL): Promise<DenoRouteTarget> {
  const deno2Url = buildDeno2Url(subdomain, url)
  return { url: deno2Url, kind: 'deno2', deno2Url }
}
