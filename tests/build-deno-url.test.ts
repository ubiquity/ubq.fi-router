import { describe, expect, test } from 'bun:test'
import {
  buildClassicDenoUrl,
  buildDeno2Url,
  isDenoDeploymentNotFound,
  resolveDenoUrl,
} from '../src/utils/build-deno-url'

describe('Deno service routing', () => {
  test('builds Deno 2 service URLs with preserved path and query', () => {
    const url = new URL('https://ai.ubq.fi/v1/models?limit=1')
    expect(buildDeno2Url('ai', url)).toBe('https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models?limit=1')
  })

  test('keeps root and other services compatible with classic Deno Deploy URL shape', () => {
    expect(buildClassicDenoUrl('', new URL('https://ubq.fi/docs'))).toBe('https://ubq-fi.deno.dev/docs')
    expect(buildClassicDenoUrl('pay', new URL('https://pay.ubq.fi/api/health'))).toBe(
      'https://pay-ubq-fi.deno.dev/api/health',
    )
  })

  test('routes to Deno 2 when the probe does not return a platform missing-deployment error', async () => {
    const url = new URL('https://ai.ubq.fi/v1/models?limit=1')
    const route = await resolveDenoUrl('ai', url, {
      cache: null,
      fetch: async (input, init) => {
        expect(String(input)).toBe('https://ai-ubq-fi.ubiquity-dao.deno.net/__ubq_route_probe__')
        expect(init?.method).toBe('HEAD')
        return new Response(null, { status: 404 })
      },
    })

    expect(route.kind).toBe('deno2')
    expect(route.url).toBe('https://ai-ubq-fi.ubiquity-dao.deno.net/v1/models?limit=1')
  })

  test('falls back to classic only when Deno 2 platform says the deployment is missing', async () => {
    const url = new URL('https://pay.ubq.fi/api/health')
    const route = await resolveDenoUrl('pay', url, {
      cache: null,
      fetch: async () =>
        new Response(null, {
          status: 404,
          headers: {
            'x-deno-error': JSON.stringify({
              code: 'DEPLOYMENT_NOT_FOUND',
              message: 'The requested deployment was not found.',
            }),
          },
        }),
    })

    expect(route.kind).toBe('classic')
    expect(route.fallbackReason).toBe('deno2_deployment_not_found')
    expect(route.url).toBe('https://pay-ubq-fi.deno.dev/api/health')
  })

  test('falls back to classic when the Deno 2 probe fails', async () => {
    const url = new URL('https://work.ubq.fi/')
    const route = await resolveDenoUrl('work', url, {
      cache: null,
      fetch: async () => {
        throw new Error('network timeout')
      },
    })

    expect(route.kind).toBe('classic')
    expect(route.fallbackReason).toBe('deno2_probe_failed')
    expect(route.url).toBe('https://work-ubq-fi.deno.dev/')
  })

  test('honors explicit null cache override', async () => {
    const globalWithCaches = globalThis as unknown as { caches?: unknown }
    const previousCaches = globalWithCaches.caches
    globalWithCaches.caches = {
      default: {
        match: async () => new Response('exists'),
        put: async () => {},
      },
    }

    try {
      const route = await resolveDenoUrl('pay', new URL('https://pay.ubq.fi/api/health'), {
        cache: null,
        fetch: async () =>
          new Response(null, {
            status: 404,
            headers: { 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' },
          }),
      })

      expect(route.kind).toBe('classic')
      expect(route.url).toBe('https://pay-ubq-fi.deno.dev/api/health')
    } finally {
      if (previousCaches === undefined) {
        delete globalWithCaches.caches
      } else {
        globalWithCaches.caches = previousCaches
      }
    }
  })

  test('detects Deno platform missing-deployment responses', () => {
    expect(isDenoDeploymentNotFound(new Headers())).toBe(false)
    expect(isDenoDeploymentNotFound(new Headers({ 'x-deno-error': '{"code":"DEPLOYMENT_NOT_FOUND"}' }))).toBe(true)
  })
})
