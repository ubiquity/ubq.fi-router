import { afterEach, describe, expect, test } from 'bun:test'
import worker, { resetOriginHealth, type Env } from '../src/worker'

const originalFetch = globalThis.fetch
const originalTransform = HTMLRewriter.prototype.transform
const revision = '0123456789abcdef0123456789abcdef01234567'
const repository = 'ubiquity/ubiquity-passport'
const appHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'x-app-revision': revision,
  'x-app-repository': repository,
}
const env = {
  VPS_ORIGIN_MAP: '{"passport.ubq.fi":"origin.ubq.fi","ai.ubq.fi":"origin.ubq.fi"}',
} as Env
const page = '<!doctype html><html><head><title>App</title></head><body><main>Hello</main><footer>App footer</footer></body></html>'

function serve(body: BodyInit | null = page, init: ResponseInit = {}): Request[] {
  const calls: Request[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input instanceof Request ? input : new Request(input))
    return new Response(body, { headers: appHeaders, ...init })
  }) as typeof fetch
  return calls
}

function fetchPage(method = 'GET', host = 'passport.ubq.fi') {
  return worker.fetch(new Request(`https://${host}/`, { method }), env)
}

afterEach(() => {
  globalThis.fetch = originalFetch
  HTMLRewriter.prototype.transform = originalTransform
  resetOriginHealth()
})

describe('app revision footers', () => {
  test('appends the deployed app hash to its footer and links the exact commit', async () => {
    const calls = serve()
    const response = await fetchPage()
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<title>App</title>')
    expect(html).toContain('<footer>App footer<style>')
    expect(html).toContain(`href="https://github.com/${repository}/commit/${revision}"`)
    expect(html).toContain('>0123456</a></footer>')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain(`aria-label="View ${repository} revision ${revision} on GitHub"`)
    expect(html).toContain('font: 12px/1.5 monospace')
    expect(html).not.toContain('❔')
    expect(html).not.toContain('ubq.fi-router/commit/')
    expect(response.headers.get('x-uos-router-revision')).toBe('local')
    expect(response.headers.get('x-uos-router-origin')).toBe('vps')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://origin.ubq.fi/')
  })

  test('creates a footer for apps without one', async () => {
    serve('<html><body><main>App</main></body></html>')
    const html = await (await fetchPage()).text()
    expect(html).toContain('<main>App</main><footer data-uos-revision-footer>')
    expect(html).toContain('>0123456</a></footer></body>')
  })

  test('supports HTML with omitted body/end tags', async () => {
    serve('<!doctype html><title>App</title><main>App</main>')
    const html = await (await fetchPage()).text()
    expect(html).toContain('<main>App</main><footer data-uos-revision-footer>')
    expect(html).toEndWith('>0123456</a></footer>')
  })

  test('leaves bodyless and untyped responses unchanged', async () => {
    serve(null)
    expect(await (await fetchPage()).text()).toBe('')
    serve(page, { headers: { 'x-app-repository': repository, 'x-app-revision': revision } })
    expect(await (await fetchPage()).text()).toBe(page)
  })

  test('reads fresh metadata for each app and deployment', async () => {
    serve()
    expect(await (await fetchPage()).text()).toContain(`/commit/${revision}`)
    const nextRevision = 'abcdef0123456789abcdef0123456789abcdef01'
    serve(page, { headers: {
      ...appHeaders,
      'x-app-revision': nextRevision,
      'x-app-repository': 'https://github.com/ubiquity/ai.ubq.fi.git/',
    } })
    const html = await (await fetchPage('GET', 'ai.ubq.fi')).text()
    expect(html).toContain(`href="https://github.com/ubiquity/ai.ubq.fi/commit/${nextRevision}"`)
    expect(html).toContain('>abcdef0</a>')
    expect(html).not.toContain(`/commit/${revision}`)
  })

  test('injects only once when a page has multiple footers', async () => {
    serve('<html><body><footer>First</footer><footer>Second</footer></body></html>')
    const html = await (await fetchPage()).text()
    expect(html.match(/<a data-uos-app-revision/g)).toHaveLength(1)
    expect(html).toContain('<footer>Second</footer>')
  })

  test('does not duplicate an existing badge on a subsequent pass', async () => {
    serve()
    const firstPass = await (await fetchPage()).text()
    serve(firstPass)
    const secondPass = await (await fetchPage()).text()
    expect(secondPass).toBe(firstPass)
  })

  test('delegates streamed HTML to the rewriter without buffering it first', async () => {
    // Bun 1.2.17 rejects JS-backed streams in its native HTMLRewriter. Model
    // Workers' lazy transform boundary, using the real parser on the completed fixture.
    HTMLRewriter.prototype.transform = function (this: HTMLRewriter, response: Response): Response {
      return new Response(new ReadableStream<Uint8Array>({
        start: async controller => {
          const parsed = originalTransform.call(this, new Response(await response.text(), response))
          controller.enqueue(new Uint8Array(await parsed.arrayBuffer()))
          controller.close()
        },
      }), response)
    }
    const encoder = new TextEncoder()
    const chunks = ['<html><body><foot', 'er>Streamed</foot', 'er></body></html>']
    let nextChunk = 0
    let resume!: () => void
    const remainingChunks = new Promise<void>(resolve => { resume = resolve })
    // Keep a live source rather than eagerly enqueueing and closing it before rewriting.
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (nextChunk > 0) await remainingChunks
        if (nextChunk === chunks.length) controller.close()
        else controller.enqueue(encoder.encode(chunks[nextChunk++]))
      },
    })
    serve(body, { headers: { ...appHeaders, 'content-type': 'Text/HTML; charset=UTF-8' } })
    const response = await fetchPage()
    // A buffering router would never return while the remaining chunks are withheld.
    resume()
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<footer>Streamed<style>')
    expect(html).toContain('>0123456</a></footer>')
  })

  test.each(['application/json', 'text/plain', 'text/event-stream', 'text/html-other'])(
    'does not rewrite %s responses', async (contentType) => {
      serve(page, { headers: { ...appHeaders, 'content-type': contentType, etag: '"original"' } })
      const response = await fetchPage()
      expect(await response.text()).toBe(page)
      expect(response.headers.get('etag')).toBe('"original"')
    },
  )

  test.each([204, 206, 302, 500])('does not rewrite HTTP %s responses', async (status) => {
    const body = status === 204 ? null : page
    serve(body, { status })
    const response = await fetchPage()
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(body || '')
  })

  test('leaves HEAD responses unchanged', async () => {
    serve(null, { headers: { ...appHeaders, 'content-length': '123' } })
    const response = await fetchPage('HEAD')
    expect(await response.text()).toBe('')
    expect(response.headers.get('content-length')).toBe('123')
  })

  test.each<Record<string, string>>([
    { 'cache-control': 'public, no-transform, max-age=60' },
    { 'content-disposition': 'attachment; filename="app.html"' },
    { 'content-range': 'bytes 0-10/100' },
  ])('honors upstream no-transform/download/range headers: %j', async (headers) => {
    serve(page, { headers: { ...appHeaders, ...headers } })
    expect(await (await fetchPage()).text()).toBe(page)
  })

  test.each<Record<string, string>>([
    {},
    { 'x-app-repository': repository },
    { 'x-app-revision': revision },
    { ...appHeaders, 'x-app-revision': 'local' },
    { ...appHeaders, 'x-app-revision': 'abc123' },
    { ...appHeaders, 'x-app-revision': 'a'.repeat(41) },
    { ...appHeaders, 'x-app-revision': '"><script>alert(1)</script>' },
    { ...appHeaders, 'x-app-repository': 'javascript:alert(1)' },
    { ...appHeaders, 'x-app-repository': 'https://github.com.evil.example/owner/repo' },
    { ...appHeaders, 'x-app-repository': 'owner/repo" onclick="alert(1)' },
    { ...appHeaders, 'x-app-repository': 'owner/..' },
  ])('never guesses or injects unsafe app metadata: %j', async (headers) => {
    serve(page, { headers: { 'content-type': 'text/html', ...headers } })
    expect(await (await fetchPage()).text()).toBe(page)
  })

  test('removes stale body validators but preserves unrelated upstream headers', async () => {
    serve(page, { headers: {
      ...appHeaders,
      'content-length': String(page.length),
      etag: '"original"',
      'content-md5': 'original-md5',
      digest: 'sha-256=original',
      'x-custom': 'preserved',
      'cache-control': 'public, max-age=60',
    } })
    const response = await fetchPage()
    expect(await response.text()).toContain('data-uos-app-revision')
    for (const name of ['content-length', 'etag', 'content-md5', 'digest']) {
      expect(response.headers.has(name)).toBe(false)
    }
    expect(response.headers.get('x-custom')).toBe('preserved')
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('x-app-revision')).toBe(revision)
  })
})
