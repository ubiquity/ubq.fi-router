/**
 * Extract subdomain key from hostname
 * ubq.fi -> ""
 * pay.ubq.fi -> "pay"
 */
export function getSubdomainKey(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length === 2) {
    return '' // ubq.fi
  } else if (parts.length === 3) {
    return parts[0] // pay.ubq.fi -> pay
  }
  throw new Error('Invalid domain format')
}