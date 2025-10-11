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
  - `ubq.fi` → `https://ubq-fi.deno.dev`
  - `<sub>.ubq.fi` → `https://<sub>-ubq-fi.deno.dev`
- Plugins (`os-*.ubq.fi`)
  - `os-<plugin>.ubq.fi` → `<plugin>-main.deno.dev`
  - `os-<plugin>-main.ubq.fi` → `<plugin>-main.deno.dev`
  - `os-<plugin>-dev[elopment].ubq.fi` → `<plugin>-development.deno.dev`
- RPC (same origin)
  - `/rpc/:chainId` → proxied to `https://rpc.ubq.fi/:chainId`

## Notes

- Routes are managed in the Cloudflare dashboard; `wrangler.toml` does not attach routes.
- We do not persist any state (no KV, no LKG, no admin endpoints).
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

### KV Cache Inspection
Check your Cloudflare KV namespace for cache entries:
- Keys follow pattern: `route:{subdomain}`
- Values: `"deno"`, `"pages"`, `"both"`, `"plugin"`, or `"none"`

### Performance Metrics
- **Bundle Size**: ~4.6kb (optimized)
- **Cache TTL**: 1 hour (success), 5 minutes (404)
- **Timeout**: 3 seconds per service check
- **Coalescing**: Prevents duplicate requests

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
