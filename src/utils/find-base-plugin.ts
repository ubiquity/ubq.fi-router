/**
 * Find base plugin name from plugin domain
 */
export function findBasePlugin(withoutPrefix: string, knownPlugins: string[]): string | null {
  // Check if it's an exact match first
  if (knownPlugins.includes(withoutPrefix)) {
    return withoutPrefix
  }

  // Try removing suffixes progressively
  const parts = withoutPrefix.split('-')
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('-')
    if (knownPlugins.includes(candidate)) {
      return candidate
    }
  }

  return null
}