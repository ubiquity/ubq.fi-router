# UBQ.FI Router — Cloudflare Worker → Deno Apps

A minimal Cloudflare Worker that deterministically routes ubq.fi traffic to Deno Deploy apps. No KV, no discovery, no sticky cookies, and no Cloudflare Pages fallback. The `/rpc/:chainId` path is exposed same‑origin per domain and proxied to `https://rpc.ubq.fi` to keep CORS simple.

See docs/deno-only-simplification.md for the URL mapping rules; we use those rules but keep the Cloudflare Worker as the single front‑door.

## Quick Start (Cloudflare Worker)

Prerequisites: Wrangler CLI authenticated to your Cloudflare account.

- Dev: `npm run cf:dev` (or `wrangler dev`)
- Deploy: `npm run cf:deploy` (or `wrangler deploy`)

Entry point: `src/worker.ts` (module worker).

## Routing Rules

- Services
  - `ubq.fi` → `https://ubq-fi.ubiquity-dao.deno.net`
  - `<sub>.ubq.fi` → `https://<sub>-ubq-fi.ubiquity-dao.deno.net`
  - Missing Deno 2 deployments are returned directly from Deno; there is no Deploy Classic fallback for service routes.
- Plugins (`os-*.ubq.fi`)
  - `os-<plugin>.ubq.fi` → `<plugin>-main.deno.dev`
  - `os-<plugin>-main.ubq.fi` → `<plugin>-main.deno.dev`
  - `os-<plugin>-dev[elopment].ubq.fi` → `<plugin>-development.deno.dev`
- RPC (same origin)
  - `/rpc/:chainId` → proxied to `https://rpc.ubq.fi/:chainId`

## VPS primary with Deno fallback

- `VPS_ORIGIN_MAP` is a JSON object mapping a public host to the origin host that reaches
  the same app on the VPS (a DNS-only hostname pointing at the VPS). Mapped hosts are tried
  on the VPS first; the existing Deno Deploy target is the fallback. Hosts absent from the
  map keep today's Deno-only behavior.
- `VPS_DEGRADED_TTL_SECONDS` (default 10, max 300) is how long an origin is skipped after a
  failed attempt, so a dead primary is not hammered on every request.
- Failover triggers before any response body is read: fetch/DNS/timeout errors from the
  primary and upstream 502/503/504. Bodies are replayed from a clone of the original
  request, so upstream writes should stay idempotent for the timeout case.
- Responses carry `x-uos-router-origin: vps|deno` and, when a fallback served the request,
  `x-uos-router-failover: 1`.
- `RETIRE_DENO=1` retires every Deno Deploy target: hosts in `VPS_ORIGIN_MAP` are
  served by the VPS only (a VPS failure answers 502), and hosts with no VPS
  origin (previews, plugins, unmapped subdomains) answer
  `410 {"error":"service_retired"}`. Unset restores the Deno fallback.

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
