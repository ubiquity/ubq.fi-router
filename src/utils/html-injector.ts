/**
 * HTML Footer Injector
 * Injects version footer into HTML responses from downstream apps
 * Matches the styling and behavior of work.ubq.fi's git hash footer
 */

export interface FooterConfig {
  // Git commit hash (short form)
  commitHash: string;
  // Full GitHub repository URL
  repoUrl: string;
  // Optional custom text (defaults to short hash)
  customText?: string;
  // Whether to inject CSS (defaults to true)
  injectStyles?: boolean;
}

export interface InjectionResult {
  injected: boolean;
  modified: boolean;
  reason?: string;
}

// Version footer HTML - matches work.ubq.fi's styling
const VERSION_FOOTER_TEMPLATE = (config: FooterConfig) => {
  const text = config.customText || config.commitHash.substring(0, 7);
  const commitUrl = `${config.repoUrl}/commit/${config.commitHash}`;
  
  return `\n<!-- Version Footer -->\n` +
    `<div id="version-footer">\n` +
    `  <a href="${commitUrl}" target="_blank" rel="noopener noreferrer" title="View commit on GitHub">${text}</a>\n` +
    `</div>\n`;
};

// CSS styles for the version footer - matches work.ubq.fi styling exactly
const VERSION_FOOTER_CSS = `
<style>
#version-footer {
  position: fixed;
  bottom: 4px;
  right: 4px;
  z-index: 999999;
  font-family: "Proxima Nova", "Ubiquity Nova", sans-serif;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 2px;
  text-rendering: geometricPrecision;
}

#version-footer a {
  color: #fff;
  text-decoration: none;
  display: inline-block;
  padding: 4px 8px;
  background-color: rgba(128, 128, 128, 0.25);
  border-radius: 4px;
  transition: opacity 0.2s ease, background-color 0.2s ease;
  opacity: 0.5;
}

#version-footer a:hover {
  opacity: 1;
  background-color: rgba(128, 128, 128, 0.4);
}

@media (prefers-color-scheme: light) {
  #version-footer a {
    color: #000;
  }
}
</style>
`;

/**
 * Check if a response should have the footer injected
 */
export function shouldInjectFooter(
  contentType: string | null,
  statusCode: number,
  url: string
): boolean {
  // Only inject into successful HTML responses
  if (statusCode < 200 || statusCode >= 300) {
    return false;
  }

  // Check content type
  if (!contentType) {
    return false;
  }

  const lowerType = contentType.toLowerCase();
  
  // Match HTML content types
  if (
    lowerType.includes('text/html') ||
    lowerType.includes('application/xhtml+xml')
  ) {
    // Skip certain paths
    const skipPaths = [
      '/__health',
      '/__version',
      '/api/',
      '/rpc/',
      '/sitemap.xml',
      '/robots.txt',
      '/favicon.ico',
    ];

    for (const skipPath of skipPaths) {
      if (url.includes(skipPath)) {
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * Inject version footer into HTML content
 * Returns the modified HTML string
 */
export function injectFooter(
  html: string,
  config: FooterConfig
): string {
  // Check if footer already exists (prevent double injection)
  if (html.includes('id="version-footer"')) {
    return html;
  }

  // Build the footer HTML
  let footerHtml = VERSION_FOOTER_TEMPLATE(config);
  
  // Add CSS if requested
  if (config.injectStyles !== false) {
    footerHtml = VERSION_FOOTER_CSS + footerHtml;
  }

  // Find the closing body tag (case-insensitive)
  const bodyEndPattern = /<\/body\s*>/i;
  const match = html.match(bodyEndPattern);

  if (match) {
    // Insert footer before closing body tag
    const position = match.index!;
    const beforeBody = html.substring(0, position);
    const afterBody = html.substring(position);
    
    return beforeBody + footerHtml + afterBody;
  }

  // If no body tag found, try to inject before closing html tag
  const htmlEndPattern = /<\/html\s*>/i;
  const htmlMatch = html.match(htmlEndPattern);

  if (htmlMatch) {
    const position = htmlMatch.index!;
    const beforeHtml = html.substring(0, position);
    const afterHtml = html.substring(position);
    
    // Add opening body tag if missing, then footer
    const bodyOpenHtml = '<body>\n' + footerHtml;
    return beforeHtml + bodyOpenHtml + afterHtml;
  }

  // If no suitable injection point found, append to end
  return html + footerHtml;
}

/**
 * Create a footer config from version result
 */
export function createFooterConfig(
  commitHash: string,
  repoUrl: string,
  customText?: string
): FooterConfig {
  return {
    commitHash,
    repoUrl,
    customText,
    injectStyles: true,
  };
}

/**
 * Check if response body is already modified
 */
export function isBodyModified(headers: Headers): boolean {
  // Check for existing footer indicator
  const hasFooter = headers.get('x-footer-injected');
  return hasFooter === 'true';
}

/**
 * Set footer injected header on response
 */
export function markAsModified(headers: Headers): void {
  headers.set('x-footer-injected', 'true');
}

/**
 * Parse content type from headers
 */
export function getContentType(headers: Headers): string | null {
  return headers.get('content-type');
}

/**
 * Check if response is compressed and needs decompression
 */
export function isCompressed(headers: Headers): boolean {
  const encoding = headers.get('content-encoding');
  if (!encoding) return false;
  
  const lowerEncoding = encoding.toLowerCase();
  return (
    lowerEncoding.includes('gzip') ||
    lowerEncoding.includes('deflate') ||
    lowerEncoding.includes('br')
  );
}

/**
 * Decompress response body if compressed
 */
export async function decompressBody(
  body: ReadableStream<Uint8Array> | null,
  encoding: string
): Promise<Uint8Array | null> {
  if (!body) return null;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Note: Full decompression would require additional libraries
  // For Cloudflare Workers, we'd need to handle this differently
  // This is a placeholder for the decompression logic
  return combined;
}

/**
 * Get the short commit hash
 */
export function getShortHash(fullHash: string): string {
  return fullHash.substring(0, 7);
}

/**
 * Validate commit hash format
 */
export function isValidCommitHash(hash: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(hash);
}
