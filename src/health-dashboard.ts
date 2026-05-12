import { getSubdomainKey } from './utils/get-subdomain-key'
import { isPluginDomain } from './utils/is-plugin-domain'
import { buildPluginUrl } from './utils/build-plugin-url'
import { resolveDenoUrl } from './utils/build-deno-url'

export interface HealthEnv {
  HEALTH_SERVICE_HOSTS?: string
  HEALTH_PLUGIN_HOSTS?: string
  HEALTH_TIMEOUT_MS?: string
}

type HealthTargetKind = 'service' | 'plugin'

type HealthTarget = Readonly<{
  kind: HealthTargetKind
  host: string
  url: string
}>

type HealthCheck = Readonly<{
  kind: HealthTargetKind
  host: string
  url: string
  ok: boolean
  status?: number
  ms: number
  error?: string
}>

const HEALTH_HOST = 'health.ubq.fi'

const DEFAULT_SERVICE_HOSTS = [
  'ubq.fi',
  'work.ubq.fi',
  'pay.ubq.fi',
  'dao.ubq.fi',
]

const DEFAULT_PLUGIN_HOSTS = [
  'os-command-start-stop.ubq.fi',
  'os-command-wallet.ubq.fi',
  'os-command-ask.ubq.fi',
]

export function isHealthDashboardHost(hostname: string): boolean {
  return hostname === HEALTH_HOST
}

export async function handleHealthDashboard(request: Request, env: HealthEnv): Promise<Response> {
  const url = new URL(request.url)
  const checks = await collectHealthChecks(env)

  if (url.pathname === '/api/health' || url.pathname === '/__health/checks') {
    return json({
      status: checks.every((check) => check.ok) ? 'ok' : 'degraded',
      generated: new Date().toISOString(),
      checks,
    })
  }

  return new Response(renderDashboard(checks), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function collectHealthChecks(env: HealthEnv): Promise<HealthCheck[]> {
  const targets = await getHealthTargets(env)
  return Promise.all(targets.map((target) => probeTarget(target, env)))
}

async function getHealthTargets(env: HealthEnv): Promise<HealthTarget[]> {
  const serviceHosts = parseHosts(env.HEALTH_SERVICE_HOSTS, DEFAULT_SERVICE_HOSTS)
  const pluginHosts = parseHosts(env.HEALTH_PLUGIN_HOSTS, DEFAULT_PLUGIN_HOSTS)

  const serviceTargets = await Promise.all(
    serviceHosts.map(async (host) => {
      const targetUrl = new URL(`https://${host}/`)
      const subdomain = getSubdomainKey(host)
      const target = await resolveDenoUrl(subdomain, targetUrl)
      return { kind: 'service' as const, host, url: target.url }
    }),
  )

  const pluginTargets = pluginHosts
    .filter((host) => isPluginDomain(host))
    .map((host) => {
      const targetUrl = new URL(`https://${host}/`)
      return { kind: 'plugin' as const, host, url: buildPluginUrl(host, targetUrl) }
    })

  return [...serviceTargets, ...pluginTargets]
}

function parseHosts(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim()
  if (!raw) return fallback

  return raw
    .split(/[,\s]+/)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

async function probeTarget(target: HealthTarget, env: HealthEnv): Promise<HealthCheck> {
  const timeout = parseTimeout(env.HEALTH_TIMEOUT_MS)
  const started = Date.now()
  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    })
    return {
      kind: target.kind,
      host: target.host,
      url: target.url,
      ok: response.status < 500,
      status: response.status,
      ms: Date.now() - started,
    }
  } catch (err) {
    return {
      kind: target.kind,
      host: target.host,
      url: target.url,
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function parseTimeout(value: string | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 4000
  return Math.min(10000, Math.max(500, n))
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function renderDashboard(checks: HealthCheck[]): string {
  const generated = new Date().toISOString()
  const okCount = checks.filter((check) => check.ok).length
  const status = okCount === checks.length ? 'Operational' : 'Degraded'
  const rows = checks.map(renderCheckRow).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UBQ.FI Health</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b1020;
      color: #eef2ff;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #111827 0%, #030712 100%);
    }
    main {
      width: min(960px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 48px 0;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-end;
      margin-bottom: 28px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 32px;
      line-height: 1.1;
    }
    p {
      margin: 0;
      color: #a5b4fc;
    }
    .badge {
      border: 1px solid ${okCount === checks.length ? '#22c55e' : '#f59e0b'};
      color: ${okCount === checks.length ? '#86efac' : '#fcd34d'};
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 14px;
      white-space: nowrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border: 1px solid #1f2937;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.82);
    }
    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid #1f2937;
      text-align: left;
      font-size: 14px;
    }
    th {
      color: #c7d2fe;
      font-weight: 600;
      background: #111827;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .state {
      font-weight: 700;
      color: #86efac;
    }
    .state.bad {
      color: #fca5a5;
    }
    code {
      color: #dbeafe;
      word-break: break-all;
    }
    footer {
      margin-top: 18px;
      color: #94a3b8;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>UBQ.FI Health</h1>
        <p>Live probes for routed apps and plugins.</p>
      </div>
      <div class="badge">${escapeHtml(status)}: ${okCount}/${checks.length}</div>
    </header>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Type</th>
          <th>Host</th>
          <th>Upstream</th>
          <th>Latency</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>Generated ${escapeHtml(generated)}. JSON: <code>/api/health</code></footer>
  </main>
</body>
</html>`
}

function renderCheckRow(check: HealthCheck): string {
  const status = check.ok ? 'OK' : 'DOWN'
  const statusClass = check.ok ? 'state' : 'state bad'
  const detail = check.status ? String(check.status) : check.error || 'error'
  return `<tr>
    <td><span class="${statusClass}">${status}</span> ${escapeHtml(detail)}</td>
    <td>${escapeHtml(check.kind)}</td>
    <td>${escapeHtml(check.host)}</td>
    <td><code>${escapeHtml(check.url)}</code></td>
    <td>${check.ms}ms</td>
  </tr>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
