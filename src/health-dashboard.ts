/**
 * Health Dashboard for UBQ.FI
 * Checks availability of all apps and plugins.
 */

const APP_SUBDOMAINS = ["pay", "work", "dashboard", "docs"] as const;
const GITHUB_API = "https://api.github.com";
const HEALTH_CHECK_TIMEOUT = 5000; // 5s per check

interface HealthEntry {
  name: string
  url: string
  type: "app" | "plugin"
  status: "healthy" | "degraded" | "unhealthy" | "unknown"
  responseTime?: number
  statusCode?: number
  error?: string
  checkedAt: string
}

interface HealthDashboard {
  version: string
  generated: string
  generator: string
  summary: {
    total: number
    healthy: number
    degraded: number
    unhealthy: number
    unknown: number
  }
  apps: HealthEntry[]
  plugins: HealthEntry[]
}

async function checkUrl(url: string, timeout = HEALTH_CHECK_TIMEOUT): Promise<{
  status: "healthy" | "degraded" | "unhealthy"
  responseTime: number
  statusCode: number
}> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
      headers: { "User-Agent": "ubq-fi-health-check" },
    });
    const responseTime = Date.now() - start;
    const statusCode = res.status;

    if (statusCode >= 200 && statusCode < 400) {
      return { status: "healthy", responseTime, statusCode };
    } else if (statusCode >= 400 && statusCode < 500) {
      // 4xx might mean the app is up but the specific path doesn't exist
      return { status: "degraded", responseTime, statusCode };
    } else {
      return { status: "unhealthy", responseTime, statusCode };
    }
  } catch (err) {
    const responseTime = Date.now() - start;
    return {
      status: "unhealthy",
      responseTime,
      statusCode: 0,
    };
  }
}

async function fetchPluginRepos(): Promise<string[]> {
  try {
    const res = await fetch(`${GITHUB_API}/orgs/ubiquity-os-marketplace/repos?per_page=100&sort=updated`, {
      headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "ubq-fi-health" },
    });
    if (!res.ok) return [];
    const repos: Array<{ name: string }> = await res.json();
    return repos
      .filter((r) => !r.name.startsWith(".") && !["command-config"].includes(r.name))
      .map((r) => r.name);
  } catch {
    return [];
  }
}

async function checkHealth(): Promise<HealthDashboard> {
  const now = new Date().toISOString();

  // Check apps
  const appEntries: HealthEntry[] = await Promise.all(
    APP_SUBDOMAINS.map(async (sub) => {
      const url = `https://${sub}.ubq.fi`;
      const result = await checkUrl(url);
      return {
        name: sub,
        url,
        type: "app" as const,
        ...result,
        checkedAt: now,
      };
    })
  );

  // Check plugins
  const pluginNames = await fetchPluginRepos();
  const pluginEntries: HealthEntry[] = await Promise.all(
    pluginNames.map(async (name) => {
      const url = `https://os-${name}.ubq.fi`;
      const result = await checkUrl(url);
      return {
        name,
        url,
        type: "plugin" as const,
        ...result,
        checkedAt: now,
      };
    })
  );

  const all = [...appEntries, ...pluginEntries];
  const summary = {
    total: all.length,
    healthy: all.filter((e) => e.status === "healthy").length,
    degraded: all.filter((e) => e.status === "degraded").length,
    unhealthy: all.filter((e) => e.status === "unhealthy").length,
    unknown: all.filter((e) => e.status === "unknown").length,
  };

  return {
    version: "1.0.0",
    generated: now,
    generator: "ubq-fi-router",
    summary,
    apps: appEntries,
    plugins: pluginEntries,
  };
}

function renderHtmlDashboard(data: HealthDashboard): string {
  const { summary, apps, plugins } = data;

  const statusIcon = (s: string) => {
    switch (s) {
      case "healthy":
        return "🟢";
      case "degraded":
        return "🟡";
      case "unhealthy":
        return "🔴";
      default:
        return "⚪";
    }
  };

  const formatTime = (ms?: number) => (ms !== undefined ? `${ms}ms` : "—");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UBQ.FI Health Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
    h1 { color: #58a6ff; margin-bottom: 0.5rem; font-size: 1.5rem; }
    .subtitle { color: #8b949e; margin-bottom: 1.5rem; font-size: 0.875rem; }
    .summary { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .summary-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.5rem; min-width: 120px; }
    .summary-card .value { font-size: 2rem; font-weight: 700; }
    .summary-card .label { color: #8b949e; font-size: 0.75rem; margin-top: 0.25rem; }
    .healthy .value { color: #3fb950; }
    .degraded .value { color: #d29922; }
    .unhealthy .value { color: #f85149; }
    .total .value { color: #58a6ff; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
    th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { font-size: 0.875rem; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; }
    .badge { padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-healthy { background: #0d2818; color: #3fb950; }
    .badge-degraded { background: #2d2000; color: #d29922; }
    .badge-unhealthy { background: #2d0b0b; color: #f85149; }
    .badge-unknown { background: #1c1c1c; color: #8b949e; }
    section h2 { color: #c9d1d9; font-size: 1.1rem; margin-bottom: 0.75rem; }
    .generated { color: #484f58; font-size: 0.75rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>🏥 UBQ.FI Health Dashboard</h1>
  <p class="subtitle">Real-time status of all apps and plugins</p>

  <div class="summary">
    <div class="summary-card total"><div class="value">${summary.total}</div><div class="label">Total Services</div></div>
    <div class="summary-card healthy"><div class="value">${summary.healthy}</div><div class="label">Healthy</div></div>
    <div class="summary-card degraded"><div class="value">${summary.degraded}</div><div class="label">Degraded</div></div>
    <div class="summary-card unhealthy"><div class="value">${summary.unhealthy}</div><div class="label">Unhealthy</div></div>
  </div>

  <section>
    <h2>Apps</h2>
    <table>
      <tr><th>Status</th><th>Name</th><th>Response</th><th>HTTP</th></tr>
      ${apps.map((a) => `<tr>
        <td><span class="status">${statusIcon(a.status)} <span class="badge badge-${a.status}">${a.status}</span></span></td>
        <td><a href="${a.url}" target="_blank">${a.name}</a></td>
        <td>${formatTime(a.responseTime)}</td>
        <td>${a.statusCode || "—"}</td>
      </tr>`).join("")}
    </table>
  </section>

  <section>
    <h2>Plugins (${plugins.length})</h2>
    <table>
      <tr><th>Status</th><th>Name</th><th>Response</th><th>HTTP</th></tr>
      ${plugins.map((p) => `<tr>
        <td><span class="status">${statusIcon(p.status)} <span class="badge badge-${p.status}">${p.status}</span></span></td>
        <td><a href="${p.url}" target="_blank">${p.name}</a></td>
        <td>${formatTime(p.responseTime)}</td>
        <td>${p.statusCode || "—"}</td>
      </tr>`).join("")}
    </table>
  </section>

  <p class="generated">Generated: ${data.generated} • <a href="/health.json">JSON API</a> • <a href="/health-history">History</a></p>
</body>
</html>`;
}

export { checkHealth, renderHtmlDashboard };
export type { HealthDashboard, HealthEntry };
