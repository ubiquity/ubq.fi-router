# UBQ.FI Router — Cloudflare Worker

A minimal Cloudflare Worker that routes ubq.fi traffic to app Workers and VPS origins, with shared app revision footers. No KV, no discovery, no sticky cookies, and no Deno or Cloudflare Pages fallback. The `/rpc/:chainId` path is exposed same‑origin per domain and proxied to `https://rpc.ubq.fi` to keep CORS simple.

See `wrangler.toml` for the production routes, app service bindings and VPS origin map.

## Quick Start (Cloudflare Worker)

Prerequisites: Wrangler CLI authenticated to your Cloudflare account.

- Dev: `npm run cf:dev` (or `wrangler dev`)
- Deploy: `npm run cf:deploy` (or `wrangler deploy`)

Entry point: `src/worker.ts` (module worker).

## Routing Rules

- `ubq.fi` and the app hosts (stake, xp, notifications, demo, onboard, card,
  keygen, work, partner, pay, kv) enter this router and are forwarded to their
  existing Cloudflare Workers through the service bindings in `wrangler.toml`.
  Explicit HTTP/HTTPS routes cover these hosts ahead of their existing
  scheme-less routes. The apps do not need source or deployment changes.
- `VPS_ORIGIN_MAP` covers passport, ai, checkout, health and the failover canary.
- Mapped hosts are proxied to `https://origin.ubq.fi` (DNS-only, straight to the
  VPS) with `x-forwarded-host`, so the VPS Caddy dispatcher picks the app and the
  app keeps its real host and origin. A failure marks the origin degraded briefly
  and answers 502; there is no second origin.
- Other hosts with no app Worker or VPS origin answer `410 {"error":"service_retired"}` — Deno Deploy
  is retired.
- `GET|POST /rpc/:chainId` stays a same-origin proxy to `https://rpc.ubq.fi`
  (the VPS Permit2 RPC proxy) with CORS headers.
- Responses carry `x-uos-router-revision`; app responses also carry
  `x-uos-router-origin: worker` or `vps`.

The exact legacy host `auth.ubq.fi` returns a 308 redirect to `https://passport.ubq.fi`, preserving the path, query and request method. Deploy the Passport backend and its exact `passport.ubq.fi` Caddy host mapping before activating this router configuration; retain the old VPS Caddy handler for rollback.

## App revision footers

The shared response middleware streams a compact, muted monospace commit link
into every app's HTML footer (or adds a footer before `</body>` when none exists),
without the ❔ icon. This applies to both Worker and VPS apps.

The host-to-repository registry is in `src/worker.ts`. Without any app changes,
the router retrieves the latest commit on that repository's default branch from
the public GitHub API, cached at the edge for 15 minutes. It displays seven
characters linked to the full commit. The tooltip and accessible label say
**Latest source revision (deployment not reported)**: repository HEAD is not
proof of the deployed version. No GitHub token or browser script is required.

Apps that already report their exact deployed commit take precedence over that
fallback, using these optional response headers:

```http
Content-Type: text/html; charset=utf-8
X-App-Repository: ubiquity/ubiquity-passport
X-App-Revision: 0123456789abcdef0123456789abcdef01234567
```

`X-App-Repository` accepts `owner/repo` or an HTTPS GitHub repository URL;
`X-App-Revision` accepts a 7–40 character hexadecimal Git commit hash. In this
case the tooltip says **Deployed revision**. Partial or invalid reported metadata
is not replaced with a guessed version. The router's own revision is never used
as an app revision.

Existing `data-uos-app-revision` badges are not duplicated. Styles are scoped to
the badge and respect the app's existing Content Security Policy. GitHub errors,
rate limits, invalid responses and a two-second lookup timeout leave app HTML
unchanged rather than breaking the app. Only full, successful HTML pages are
rewritten; HEAD, partial/error responses, attachments, `Cache-Control:
no-transform`, API responses and RPC streams pass through without metadata
lookups. Body length/integrity validators are removed on rewritten responses.

## Health dashboard

The router serves `https://health.ubq.fi/` and its read-only `/api/health` JSON
endpoint directly. Other health-host paths still use the existing VPS mapping;
`/__health` remains router liveness, not app/plugin test health. Attach the
`health.ubq.fi/*` route to this Worker in Cloudflare before enabling the dashboard
(the VPS-only hostname will otherwise keep serving its existing application).

By default the dashboard monitors this repository's `ci.yml` on `main`. Set the
optional `HEALTH_CHECKS` Worker variable to a JSON array to include public app and
plugin repositories, for example:

```json
[
  { "name": "Router", "repository": "ubiquity/ubq.fi-router", "workflow": "ci.yml", "branch": "main" },
  { "name": "Example plugin", "repository": "ubiquity-os/example-plugin", "workflow": "tests.yml", "branch": "main" }
]
```

`repository` is required; `name`, `workflow`, and `branch` default to the repository
name, `ci.yml`, and `main`. Configure at most 20 checks. An optional server-side
`GITHUB_TOKEN` secret raises GitHub API rate limits; it is never sent to the browser.
Only configure repositories whose test results may be published publicly.

The latest **push** workflow run on each configured branch supplies its test
status. Success is `operational`; failure/timeout is `degraded`; queued/running
checks are `pending`; missing, cancelled, skipped, or unavailable results are
`unknown`, never passing. Each result includes its repository, workflow, branch,
run update time, and GitHub run link when available. These are CI results, not
live service availability guarantees.

The API returns `{ status, updatedAt, checks }`, with an optional `error` for invalid
configuration. Overall status is `operational` only when every check passes,
`degraded` when any fails, otherwise `unknown`. HTTP status is 200 for operational
and 503 otherwise. `GET`, `HEAD`, and CORS `OPTIONS` are supported so other
organization dashboards/monitoring tools can consume the same results without
browser credentials. Requests time out after five seconds per GitHub check;
results (including unavailable states) are cached in the Worker isolate for 60
seconds, with concurrent requests sharing the same lookup. The page refreshes
every minute and links each check to its workflow run.

## Notes

- Routes are managed in the Cloudflare dashboard; `wrangler.toml` does not attach routes.
- We do not persist app state (no KV, no LKG, no admin endpoints).
- Upstream headers/status are passed through; we strip host/origin/referer/cookie to upstream.


## 🔧 Development Workflow

### Local Development
```bash
# Start development server
bun run dev

# In another terminal, test locally
curl http://localhost:8787 -H "Host: pay.ubq.fi"
```

### Deployment Process
```bash
# Type check
bun run type-check

# Build
bun run build

# Deploy
bun run deploy
```

### Debugging New Services
1. Deploy service to Deno Deploy or Cloudflare Pages
2. Force cache refresh: `curl -H "X-Cache-Control: refresh" https://newservice.ubq.fi`
3. Verify routing with normal request: `curl https://newservice.ubq.fi`

## 📊 Monitoring

### Worker Logs (Host-aware)
- The Worker emits structured JSON logs for each request, including `inHost` (derived from URL) and `hostHeader` (raw `Host` header), plus `path`, `status`, `ms`, and `cfRay`.
- In Cloudflare Workers Observability → Logs, filter by host using substring search, for example:
  - `"hostHeader":"devpool.directory"`
  - or `"inHost":"work.ubq.fi"`
- Events:
  - `event: "route"` for successful proxy/rpc requests
  - `event: "route_error"` on upstream failures
  - `event: "health"` for `GET /__health`

### Performance Metrics
- **Bundle Size**: ~4.6kb (optimized)
- **Proxy Timeout**: 6 seconds

## 🔍 Troubleshooting

### Common Issues

**Service shows as available but returns 404**
- Check if the actual service URL exists
- Verify URL building logic in `src/utils/build-deno-url.ts`

**Build failures**
- Run `bun run type-check` for TypeScript errors
- Ensure all dependencies are installed: `bun install`
- Check esbuild configuration in `package.json`

See [docs/troubleshooting.md](docs/troubleshooting.md) for detailed solutions.

## 📚 Documentation

- [Architecture Details](docs/architecture.md) - System design and data flow
- [API Reference](docs/api-reference.md) - Complete API documentation
- [Sitemap Generation](docs/sitemap.md) - Dynamic sitemap features and configuration
- [Deployment Guide](docs/deployment.md) - Production deployment
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

## 🤝 Contributing

1. Make changes to TypeScript files in `src/`
2. Run type checking: `bun run type-check`
3. Test locally: `bun run dev`
4. Deploy: `bun run deploy`

## 📄 License

[Your License Here]

---

**Need Help?** Check the [troubleshooting guide](docs/troubleshooting.md) or review the [architecture documentation](docs/architecture.md).
