/**
 * Check if hostname is a plugin domain (os-*.ubq.fi)
 */
export function isPluginDomain(hostname: string): boolean {
  const parts = hostname.split('.')
  return parts.length === 3 &&
         parts[0].startsWith('os-') &&
         parts[1] === 'ubq' &&
         parts[2] === 'fi'
}