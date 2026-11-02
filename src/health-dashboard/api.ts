import { HEALTH_PAGE } from './page'

export interface HealthDashboardEnv {
  /** JSON array of public repositories and the test workflows to monitor. */
  HEALTH_CHECKS?: string
  /** Optional server-side token for GitHub API rate limits. */
  GITHUB_TOKEN?: string
}

interface Check {
  name: string
  repository: string
  workflow: string
  branch: string
}

type Status = 'operational' | 'degraded' | 'pending' | 'unknown'
interface CheckResult extends Check {
  status: Status
  updatedAt?: string
  url?: string
  error?: string
}
export interface HealthSnapshot {
  status: 'operational' | 'degraded' | 'unknown'
  updatedAt: string
  checks: CheckResult[]
  error?: string
}

const DEFAULT_CHECKS: Check[] = [{
  name: 'Router',
  repository: 'ubiquity/ubq.fi-router',
  workflow: 'ci.yml',
  branch: 'main',
}]
const CACHE_MS = 60_000
let cached: { configuration?: string; token?: string; until: number; snapshot: Promise<HealthSnapshot> } | undefined

function parseChecks(raw: string | undefined): Check[] {
  const values: unknown = raw === undefined ? DEFAULT_CHECKS : JSON.parse(raw)
  if (!Array.isArray(values) || values.length === 0 || values.length > 20) throw new Error('Invalid checks')
  return values.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid check')
    const { repository, workflow = 'ci.yml', branch = 'main', name = repository } = value as Record<string, unknown>
    if (
      typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      repository.split('/').some((part) => part === '.' || part === '..') ||
      typeof workflow !== 'string' || !/^[\w-][\w.-]*\.ya?ml$/.test(workflow) ||
      typeof branch !== 'string' || !branch.trim() || branch.length > 255 ||
      typeof name !== 'string' || !name.trim()
    ) throw new Error('Invalid check')
    return { name, repository, workflow, branch }
  })
}

async function checkWorkflow(check: Check, token?: string): Promise<CheckResult> {
  const result: CheckResult = { ...check, status: 'unknown' }
  try {
    const url = new URL(
      `https://api.github.com/repos/${check.repository}/actions/workflows/${encodeURIComponent(check.workflow)}/runs`,
    )
    url.search = new URLSearchParams({ branch: check.branch, event: 'push', per_page: '1' }).toString()
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ubq-fi-health-dashboard',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    // Pass options directly: older Bun versions lose redirect: 'error' in Request.
    const response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return { ...result, error: `GitHub returned ${response.status}` }
    const data = await response.json() as { workflow_runs?: unknown[] }
    if (!Array.isArray(data.workflow_runs)) throw new Error('Invalid GitHub response')
    const run = data.workflow_runs[0] as Record<string, unknown> | undefined
    if (!run || typeof run !== 'object') return { ...result, error: 'No workflow runs found' }
    if (run.status === 'completed') {
      if (run.conclusion === 'success') result.status = 'operational'
      else if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(String(run.conclusion))) {
        result.status = 'degraded'
      }
    } else if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(String(run.status))) {
      result.status = 'pending'
    }
    if (typeof run.updated_at === 'string' && Number.isFinite(Date.parse(run.updated_at))) {
      result.updatedAt = run.updated_at
    }
    if (Number.isSafeInteger(run.id) && Number(run.id) > 0) {
      result.url = `https://github.com/${check.repository}/actions/runs/${run.id}`
    }
    return result
  } catch {
    return { ...result, error: 'CI status unavailable' }
  }
}

async function buildSnapshot(env: HealthDashboardEnv): Promise<HealthSnapshot> {
  let checks: Check[]
  try {
    checks = parseChecks(env.HEALTH_CHECKS)
  } catch {
    return {
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      checks: [],
      error: 'Invalid HEALTH_CHECKS configuration',
    }
  }
  const results = await Promise.all(checks.map((check) => checkWorkflow(check, env.GITHUB_TOKEN)))
  const status = results.some((check) => check.status === 'degraded')
    ? 'degraded'
    : results.every((check) => check.status === 'operational')
    ? 'operational'
    : 'unknown'
  return { status, updatedAt: new Date().toISOString(), checks: results }
}

function snapshot(env: HealthDashboardEnv): Promise<HealthSnapshot> {
  if (
    cached && cached.configuration === env.HEALTH_CHECKS && cached.token === env.GITHUB_TOKEN &&
    cached.until > Date.now()
  ) {
    return cached.snapshot
  }
  const pending = buildSnapshot(env)
  cached = {
    configuration: env.HEALTH_CHECKS,
    token: env.GITHUB_TOKEN,
    until: Date.now() + CACHE_MS,
    snapshot: pending,
  }
  return pending
}

/** Only claim the dashboard endpoints; existing VPS paths and router liveness remain intact. */
export async function handleHealthDashboard(request: Request, env: HealthDashboardEnv): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.hostname !== 'health.ubq.fi' || (url.pathname !== '/' && url.pathname !== '/api/health')) return null
  const isApi = url.pathname === '/api/health'
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  if (isApi) {
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD, OPTIONS')
    return new Response('Method not allowed', { status: 405, headers })
  }
  if (!isApi) {
    headers.set('Content-Type', 'text/html; charset=utf-8')
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    return new Response(request.method === 'HEAD' ? null : HEALTH_PAGE, { headers })
  }
  const health = await snapshot(env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(health), {
    status: health.status === 'operational' ? 200 : 503,
    headers,
  })
}
