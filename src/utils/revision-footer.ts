const ROUTER_REPOSITORY_URL = 'https://github.com/ubiquity/ubq.fi-router'

/**
 * Representation-level validators and digest headers that become invalid once
 * the HTML payload is rewritten with the router revision footer.
 */
export const REWRITTEN_HTML_REMOVED_HEADERS = [
  'content-length',
  'content-md5',
  'digest',
  'content-digest',
  'repr-digest',
  'etag',
] as const

export function hasNoTransformDirective(cacheControl: string | null | undefined): boolean {
  if (!cacheControl) return false
  return cacheControl
    .split(',')
    .some((directive) => directive.trim().toLowerCase().split('=')[0]?.trim() === 'no-transform')
}

export function shouldDecorateHtmlResponse(request: Request, response: Response): boolean {
  if (request.method.toUpperCase() !== 'GET') return false
  if (response.status < 200 || response.status >= 300 || response.status === 204 || response.status === 205) {
    return false
  }
  if (!response.body) return false

  const contentType = response.headers.get('content-type') ?? ''
  if (!/\btext\/html\b/i.test(contentType)) return false

  const contentEncoding = (response.headers.get('content-encoding') ?? '').trim().toLowerCase()
  if (contentEncoding && contentEncoding !== 'identity') return false

  if (hasNoTransformDirective(request.headers.get('cache-control'))) return false
  if (hasNoTransformDirective(response.headers.get('cache-control'))) return false

  return true
}

export function injectRevisionFooter(html: string, revision: string): string {
  const safeRevision = revision.trim() || 'local'
  const href =
    safeRevision === 'local'
      ? ROUTER_REPOSITORY_URL
      : `${ROUTER_REPOSITORY_URL}/commit/${encodeURIComponent(safeRevision)}`
  const link = `<a id="git-revision" href="${href}" rel="noopener noreferrer" target="_blank">Revision ${safeRevision}</a>`

  if (/\bid=(['"])git-revision\1/i.test(html)) {
    return html.replace(/<a\b([^>]*\bid=(['"])git-revision\2[^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string) => {
      const cleaned = attrs
        .replace(/\s+href=(['"])[\s\S]*?\1/i, '')
        .replace(/\s+target=(['"])[\s\S]*?\1/i, '')
        .replace(/\s+rel=(['"])[\s\S]*?\1/i, '')
      return `<a${cleaned} href="${href}" rel="noopener noreferrer" target="_blank">Revision ${safeRevision}</a>`
    })
  }

  if (/<\/footer>/i.test(html)) {
    return html.replace(/<\/footer>/i, `${link}</footer>`)
  }

  const footer = `<footer data-uos-router-revision="true">${link}</footer>`
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`)
  }

  return `${html}${footer}`
}

export async function decorateHtmlRevisionFooter(
  request: Request,
  response: Response,
  revision: string
): Promise<Response> {
  if (!shouldDecorateHtmlResponse(request, response)) {
    return response
  }

  const html = await response.text()
  const rewritten = injectRevisionFooter(html, revision)
  const headers = new Headers(response.headers)

  if (rewritten !== html) {
    for (const headerName of REWRITTEN_HTML_REMOVED_HEADERS) {
      headers.delete(headerName)
    }
  }

  return new Response(rewritten, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
