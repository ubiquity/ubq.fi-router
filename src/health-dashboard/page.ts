export const HEALTH_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ubiquity Health</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
    body { max-width: 64rem; margin: 3rem auto; padding: 0 1rem; }
    h1 { margin-bottom: .25rem; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td { padding: .8rem .4rem; border-bottom: 1px solid #8886; overflow-wrap: anywhere; }
    [data-status] { font-weight: 600; }
    [data-status="operational"] { color: light-dark(#166534, #86efac); }
    [data-status="degraded"] { color: light-dark(#991b1b, #fca5a5); }
    [data-status="pending"], [data-status="unknown"] { color: light-dark(#854d0e, #fde047); }
    a { color: inherit; }
    .table-scroll { overflow-x: auto; }
    footer { margin-top: 2rem; }
  </style>
</head>
<body>
  <main>
    <h1>Ubiquity Health</h1>
    <p>Latest test workflow results for Ubiquity apps and plugins. CI results are not live uptime probes.</p>
    <section aria-live="polite" aria-atomic="true">
      <h2 id="overall" data-status="unknown">Loading test results…</h2>
      <p id="updated">Checking GitHub Actions. Refreshes every minute.</p>
    </section>
    <div class="table-scroll">
      <table>
        <caption>App and plugin test results</caption>
        <thead><tr><th scope="col">Service</th><th scope="col">Tests</th><th scope="col">Last run update</th></tr></thead>
        <tbody id="checks"></tbody>
      </table>
    </div>
    <noscript>JavaScript is required to refresh this dashboard. Test results are also available from the JSON API below.</noscript>
  </main>
  <footer><a href="/api/health">Health JSON API</a> · Results may be cached for up to 60 seconds.</footer>
  <script>
    const labels = { operational: 'Passing', degraded: 'Failing', pending: 'Running or queued', unknown: 'Unknown' };
    const overall = document.getElementById('overall');
    const updated = document.getElementById('updated');
    const checks = document.getElementById('checks');
    async function refresh() {
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const health = await response.json();
        overall.textContent = health.status === 'operational' ? 'All monitored tests passing'
          : health.status === 'degraded' ? 'Some monitored tests failing' : 'Test status not yet known';
        overall.dataset.status = health.status;
        updated.textContent = health.error || 'Last checked: ' + new Date(health.updatedAt).toLocaleString();
        checks.replaceChildren();
        for (const check of health.checks) {
          const row = document.createElement('tr');
          const service = document.createElement('td');
          const link = document.createElement('a');
          link.textContent = check.name;
          link.href = check.url || 'https://github.com/' + check.repository + '/actions';
          service.append(link);
          const status = document.createElement('td');
          status.dataset.status = check.status;
          status.textContent = check.error || labels[check.status] || labels.unknown;
          const time = document.createElement('td');
          time.textContent = check.updatedAt ? new Date(check.updatedAt).toLocaleString() : 'No run available';
          row.append(service, status, time);
          checks.append(row);
        }
      } catch {
        overall.textContent = 'Test status unavailable';
        overall.dataset.status = 'unknown';
        updated.textContent = 'Unable to refresh. Previously displayed results may be out of date; retrying in one minute.';
      } finally {
        setTimeout(refresh, 60000);
      }
    }
    refresh();
  </script>
</body>
</html>`
