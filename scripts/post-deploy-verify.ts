/**
 * Post-deploy verification script for UBQ.FI router
 * Usage:
 *   BASE_HOST=ubq.fi ADMIN_TOKEN=... bun scripts/post-deploy-verify.ts
 */

type Check = () => Promise<void>

const BASE_HOST = process.env.BASE_HOST || 'ubq.fi'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''

async function http(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init)
  const text = await res.text()
  return { res, text }
}

function assert(cond: any, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function header(h: Headers, name: string): string | null {
  for (const [k, v] of h.entries()) if (k.toLowerCase() === name.toLowerCase()) return v
  return null
}

async function checkHealth(): Promise<void> {
  const { res, text } = await http(`https://${BASE_HOST}/__health`)
  assert(res.status === 200, `Health status ${res.status}`)
  assert(header(res.headers, 'content-type')?.includes('application/json') === true, 'Health content-type')
  assert(text.includes('"status":"ok"'), 'Health payload missing status ok')
}

async function checkRootAndCookie(host: string): Promise<void> {
  const url = `https://${host}/`
  const first = await fetch(url, { redirect: 'manual' })
  assert(first.status < 500, `${host} first status ${first.status}`)
  const setCookie = header(first.headers, 'set-cookie') || ''
  assert(setCookie.includes('ubqpf='), `${host} missing Set-Cookie ubqpf on first response`)
  const cookie = setCookie.split(';')[0]
  const second = await fetch(url, { headers: { Cookie: cookie }, redirect: 'manual' })
  assert(second.status < 500, `${host} second status ${second.status}`)
}

async function checkSitemap(): Promise<void> {
  const { res: r1 } = await http(`https://${BASE_HOST}/sitemap.xml`)
  assert(r1.status === 200 || r1.status === 304, `sitemap.xml status ${r1.status}`)
  const { res: r2 } = await http(`https://${BASE_HOST}/sitemap.json`)
  assert(r2.status === 200 || r2.status === 304, `sitemap.json status ${r2.status}`)
}

async function checkPluginMap(): Promise<void> {
  const { res: r1 } = await http(`https://${BASE_HOST}/plugin-map.xml`)
  assert(r1.status === 200 || r1.status === 304, `plugin-map.xml status ${r1.status}`)
  const { res: r2 } = await http(`https://${BASE_HOST}/plugin-map.json`)
  assert(r2.status === 200 || r2.status === 304, `plugin-map.json status ${r2.status}`)
}

async function checkRpcCors(): Promise<void> {
  const { res } = await http(`https://${BASE_HOST}/rpc/1`, { method: 'OPTIONS' })
  assert(res.status === 204, `RPC OPTIONS status ${res.status}`)
  assert(header(res.headers, 'access-control-allow-origin') === '*', 'RPC CORS header missing')
}

async function checkAdminEndpoints(): Promise<void> {
  if (!ADMIN_TOKEN) {
    console.log('⚠️  Skipping admin checks (set ADMIN_TOKEN to enable)')
    return
  }
  const target = 'pay.ubq.fi'
  const base = `https://${BASE_HOST}/__platform?host=${encodeURIComponent(target)}`
  const h = { 'X-Admin-Token': ADMIN_TOKEN }
  const get1 = await fetch(base, { headers: h })
  assert(get1.status === 200, `/__platform GET status ${get1.status}`)
  const post = await fetch(base + '&platform=pages', { method: 'POST', headers: h })
  assert(post.status === 200, `/__platform POST status ${post.status}`)
  const post2 = await fetch(base + '&platform=deno', { method: 'POST', headers: h })
  assert(post2.status === 200, `/__platform POST2 status ${post2.status}`)
}

async function main() {
  const checks: Array<[string, Check]> = [
    ['Health', checkHealth],
    ['Root ubq.fi + cookie', () => checkRootAndCookie(BASE_HOST)],
    ['Root pay.ubq.fi + cookie', () => checkRootAndCookie('pay.ubq.fi')],
    ['Sitemap', checkSitemap],
    ['Plugin map', checkPluginMap],
    ['RPC CORS', checkRpcCors],
    ['Admin endpoints', checkAdminEndpoints],
  ]
  let passed = 0
  for (const [name, fn] of checks) {
    try {
      await fn()
      console.log(`✅ ${name}`)
      passed++
    } catch (e: any) {
      console.error(`❌ ${name}:`, e?.message || e)
      process.exitCode = 1
    }
  }
  console.log(`\nSummary: ${passed}/${checks.length} checks passed`)
  if (process.exitCode) process.exit(process.exitCode)
}

main()

