/**
 * Extract subdomain key from hostname
 * ubq.fi -> ""
 * www.ubq.fi -> "" (treat www same as root)
 * pay.ubq.fi -> "pay"
 */
export function getSubdomainKey(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length === 2) {
    return '' // ubq.fi
  } else if (parts.length === 3) {
    const subdomain = parts[0]
    // Treat www subdomain the same as root domain
    if (subdomain === 'www') {
      return ''
    }
    return subdomain // pay.ubq.fi -> pay
  }
  throw new Error('Invalid domain format')
}
