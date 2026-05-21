export type RevisionFooterOptions = Readonly<{
  revision: string
  repositoryUrl: string
}>

const FOOTER_ID = 'uos-router-revision-footer'
const GIT_REVISION_LINK_RE =
  /<a\b[^>]*\bid=(["'])git-revision\1[^>]*>[\s\S]*?<\/a>/i

export function repositoryUrlForHost(hostname: string): string {
  const host = hostname.toLowerCase()
  if (host === 'ubq.fi' || host === 'www.ubq.fi') {
    return 'https://github.com/ubiquity/ubq.fi'
  }

  const subdomain = host.endsWith('.ubq.fi')
    ? host.slice(0, -'.ubq.fi'.length)
    : host
  const appName = subdomain.startsWith('preview-')
    ? subdomain.slice('preview-'.length)
    : subdomain

  return `https://github.com/ubiquity/${appName}.ubq.fi`
}

export function decorateHtmlWithRevision(
  html: string,
  { revision, repositoryUrl }: RevisionFooterOptions,
): string {
  const shortRevision = shortRevisionHash(revision)
  const revisionHref = revision === 'local'
    ? repositoryUrl
    : `${repositoryUrl}/commit/${encodeURIComponent(revision)}`
  const revisionLink = `<a id="git-revision" href="${escapeHtml(revisionHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortRevision)}</a>`

  if (GIT_REVISION_LINK_RE.test(html)) {
    return html.replace(GIT_REVISION_LINK_RE, revisionLink)
  }

  const footer = [
    `<div id="${FOOTER_ID}">`,
    revisionLink,
    '</div>',
    '<style>',
    `#${FOOTER_ID}{position:fixed;right:4px;bottom:4px;z-index:2147483647}`,
    `#${FOOTER_ID} a{text-align:center;text-transform:uppercase;letter-spacing:2px;text-rendering:geometricPrecision;font:700 10px/1.2 monospace;color:#fff;text-decoration:none;opacity:.75;display:inline-block;text-shadow:0 1px 2px #000}`,
    `#${FOOTER_ID} a:hover{opacity:1}`,
    '</style>',
  ].join('')

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`)
  }

  return `${html}${footer}`
}

export function isHtmlResponse(headers: Headers): boolean {
  return headers.get('content-type')?.toLowerCase().includes('text/html') === true
}

function shortRevisionHash(revision: string): string {
  return revision === 'local' ? revision : revision.slice(0, 7)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
