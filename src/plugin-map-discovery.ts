import type { HealthSnapshot } from './health-dashboard/api'

type CheckResult = HealthSnapshot['checks'][number]
type Status = CheckResult['status']

export interface AppRoute {
  url: string
  repository?: string
  name?: string
}

export interface MapEntry extends AppRoute {
  name: string
  status: Status
  checks: CheckResult[]
}

export function mapStatus(results: readonly { status: Status }[]): Status {
  if (results.some((result) => result.status === 'degraded')) return 'degraded'
  if (!results.length || results.some((result) => result.status === 'unknown')) return 'unknown'
  return results.every((result) => result.status === 'operational') ? 'operational' : 'pending'
}

function entry(route: AppRoute, checks: CheckResult[]): MapEntry {
  return {
    ...route,
    name: route.name ?? checks[0]?.name ?? new URL(route.url).hostname,
    status: mapStatus(checks),
    checks,
  }
}

function sorted(entries: MapEntry[]): MapEntry[] {
  return entries.sort((a, b) => a.url.localeCompare(b.url))
}

/** Discover plugins from the same explicitly public checks used by the dashboard. */
export function discoverPluginMap(health: HealthSnapshot): MapEntry[] {
  const plugins = new Map<string, CheckResult[]>()
  for (const check of health.checks) {
    if (check.kind !== 'plugin') continue
    const url = check.siteUrl ?? `https://github.com/${check.repository.toLowerCase()}`
    const checks = plugins.get(url) ?? []
    checks.push(check)
    plugins.set(url, checks)
  }
  return sorted([...plugins].map(([url, checks]) => entry({ url, repository: checks[0].repository }, checks)))
}

/** Include active router apps plus explicitly configured public app URLs. */
export function discoverAppMap(health: HealthSnapshot, apps: AppRoute[]): MapEntry[] {
  const routes = new Map(apps.map((app) => [app.url, app]))
  for (const check of health.checks) {
    if (check.kind !== 'plugin' && check.siteUrl) {
      routes.set(check.siteUrl, routes.get(check.siteUrl) ?? {
        url: check.siteUrl, repository: check.repository, name: check.name,
      })
    }
  }
  return sorted([...routes.values()].map((route) => entry(route, health.checks.filter((check) =>
    check.kind !== 'plugin' &&
    (check.siteUrl === route.url || check.repository.toLowerCase() === route.repository?.toLowerCase())
  ))))
}
