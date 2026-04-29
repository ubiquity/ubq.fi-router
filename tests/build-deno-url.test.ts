import { describe, expect, test } from 'bun:test'
import {
  buildDeno2AppSlug,
  buildDeno2Url,
  resolveDenoUrl,
} from '../src/utils/build-deno-url'

describe('Deno service routing', () => {
  test('builds Deno 2 service app slugs', () => {
    expect(buildDeno2AppSlug('')).toBe('ubq-fi')
    expect(buildDeno2AppSlug('ai')).toBe('ai-ubq-fi')
  })

  test('builds Deno 2 service URLs with preserved path and query', () => {
    const url = new URL('https://ai.ubq.fi/v1/models?limit=1')
    expect(buildDeno2Url('ai', url)).toBe('https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models?limit=1')
  })

  test('routes directly to Deno 2 without probing Classic fallback state', async () => {
    const url = new URL('https://work.ubq.fi/')
    const route = await resolveDenoUrl('work', url)

    expect(route.kind).toBe('deno2')
    expect(route.deno2Url).toBe('https://work-ubq-fi.ubiquity-dao.deno.net/')
    expect(route.url).toBe(route.deno2Url)
  })
})
