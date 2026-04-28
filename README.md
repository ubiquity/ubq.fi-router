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
  - `ubq.fi` → try `https://ubq-fi.ubiquity-dao.deno.net`, fall back to `https://ubq-fi.deno.dev`
  - `<sub>.ubq.fi` → try `https://<sub>-ubq-fi.ubiquity-dao.deno.net`, fall back to `https://<sub>-ubq-fi.deno.dev`
  - Deno 2 is considered missing only when the Deno platform returns `x-deno-error.code=DEPLOYMENT_NOT_FOUND`
  - Deploy Classic fallback responses include deprecation headers for the July 20, 2026 Deploy Classic shutdown
- Plugins (`os-*.ubq.fi`)
  - `os-<plugin>.ubq.fi` → `<plugin>-main.deno.dev`
  - `os-<plugin>-main.ubq.fi` → `<plugin>-main.deno.dev`
  - `os-<plugin>-dev[elopment].ubq.fi` → `<plugin>-development.deno.dev`
- RPC (same origin)
  - `/rpc/:chainId` → proxied to `https://rpc.ubq.fi/:chainId`

## Notes

- Routes are managed in the Cloudflare dashboard; `wrangler.toml` does not attach routes.
- We do not persist app state (no KV, no LKG, no admin endpoints). The Worker uses short-lived Cloudflare Cache entries for Deno 2 existence probes.
- Upstream headers/status are passed through; we strip host/origin/referer/cookie to upstream.
- Deploy Classic fallback responses include `Deprecation`, `Sunset`, `Warning`, and `X-UOS-Deno-Classic-*` headers.
- If both the Deno 2 app and Deploy Classic fallback are missing, the Worker returns a JSON `503` explaining that Deploy Classic is sunsetted and the service must be migrated.


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

### Deno 2 Probe Cache
- Positive Deno 2 probe results are cached for 5 minutes.
- Missing Deno 2 app results are cached for 60 seconds.
- Probe errors are not cached and fall back to Deploy Classic for that request.

### Performance Metrics
- **Bundle Size**: ~4.6kb (optimized)
- **Probe Cache TTL**: 5 minutes for Deno 2 apps, 60 seconds for missing Deno 2 apps
- **Probe Timeout**: 1.5 seconds
- **Proxy Timeout**: 6 seconds

## 🔍 Troubleshooting

### Common Issues

**Service shows as available but returns 404**
- Check if the actual service URL exists
- Verify URL building logic in `src/utils.ts`
- Clear cache and refresh: `curl -H "X-Cache-Control: clear" https://domain.ubq.fi`

**Cache not updating**
- Use `X-Cache-Control: refresh` to force update
- Check KV namespace configuration
- Verify cache TTL settings

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
