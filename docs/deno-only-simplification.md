# Deno‑Only Simplification Specification

Note (amended): We are keeping the Cloudflare Worker as the single front door, and it deterministically proxies to Deno Deploy apps using the routing rules below. No Cloudflare Pages is used as a fallback, and we do not change DNS for RPC concerns since `/rpc/:chainId` is mounted same‑origin on each ubq.fi host by the Worker and proxied to `https://rpc.ubq.fi`.

This document describes how to simplify the ubq.fi router by migrating to a single Deno Deploy app and removing all Cloudflare‑specific logic, KV, discovery, and fallbacks.

## Goals
- Deno Deploy only (no Cloudflare Pages or Workers).
- Zero persistence: remove KV, LKG, sticky hints, admin pinning, circuit breakers.
- Deterministic routing based on hostname patterns.
- Minimal, fast, and maintainable codebase with a tiny Deno app.

## Non‑Goals
- No fallback to Cloudflare Pages/Workers.
- No GitHub discovery or periodic API calls.
- No request hedging, platform detection, or circuit breaking.

## Architecture
- One Deno Deploy service responsible for all ubq.fi traffic:
  - Apex `ubq.fi` and subdomains (e.g., `pay.ubq.fi`).
  - Plugin subdomains `os-*.ubq.fi` with deterministic mapping.
  - Optional same‑origin RPC proxy to `https://rpc.ubq.fi`.
- Cloudflare DNS points ubq.fi and required subdomains to Deno Deploy (CNAME flattening at apex).

## Routing Rules
- Services
  - Root: `ubq.fi` → `https://ubq-fi.deno.dev`
  - Subdomain: `<sub>.ubq.fi` → `https://<sub>-ubq-fi.deno.dev`
- Plugins (`os-*.ubq.fi`)
  - `os-<plugin>.ubq.fi` → `https://<plugin>-main.deno.dev`
  - `os-<plugin>-main.ubq.fi` → `https://<plugin>-main.deno.dev`
  - `os-<plugin>-dev.ubq.fi` or `os-<plugin>-development.ubq.fi` → `https://<plugin>-development.deno.dev`
- Behavior
  - Always proxy to the computed Deno URL and stream the response.
  - No Pages/Workers or multi‑platform fallback; return upstream status as‑is.

## Endpoints
- `GET /__health` → 200 JSON `{ status: "ok" }`.
- `GET/HEAD /*` → proxy using the routing rules above.
- `GET/POST/OPTIONS /rpc/:chainId` → proxy to `https://rpc.ubq.fi/:chainId`.
  - OPTIONS: 204 with permissive CORS only if cross‑origin is expected; otherwise omit.
- Optional (only if you want them):
  - `/sitemap.xml`, `/sitemap.json` → serve static files or generate from a local config (no KV).

## Configuration
- Prefer zero env. If needed:
  - `RPC_ALLOWLIST` (optional) to restrict which `chainId`s are proxied.
- No secrets or tokens required for normal routing.

## Remove (Delete) Completely
- Cloudflare Worker + Pages logic
  - `wrangler.toml`, CI steps deploying Workers.
  - All Pages URL builders and usage.
- Persistence & state
  - KV wrappers, rate‑limited writes, caches, LKG, memory caches, circuit breakers.
- Discovery & admin
  - GitHub discovery, sitemap/plugin‑map generation code (unless kept as static), coalescing.
  - Admin endpoints: `/__platform`, `/__seed-lkg`.
- Cookies/hints
  - `ubqpf` sticky cookie logic.

## Minimal Code Structure (Deno Deploy)
```
.
├─ deno.json
├─ src/
│  ├─ server.ts              # Deno entry: Deno.serve(fetch)
│  ├─ utils/
│  │  ├─ url.ts             # getSubdomainKey, isPluginDomain, getPluginName
│  │  └─ proxy.ts           # proxy(request, targetUrl)
│  └─ routes/
│     └─ rpc.ts             # /rpc handler (optional)
├─ public/
│  └─ index.html            # optional local index
└─ README.md
```

### `src/utils/url.ts`
- `getSubdomainKey(hostname)`
  - `ubq.fi` and `www.ubq.fi` → empty string
  - `pay.ubq.fi` → `pay`
- `isPluginDomain(hostname)`
  - Matches `os-*.ubq.fi`
- `getPluginName(hostname)`
  - `os-<name>[-main|-dev|-development].ubq.fi` → `<name>-<branch>` with default branch `main`
- `buildDenoUrl(subdomain, url)`
  - `""` → `https://ubq-fi.deno.dev${url.pathname}${url.search}`
  - otherwise → `https://<sub>-ubq-fi.deno.dev${url.pathname}${url.search}`
- `buildPluginDenoUrl(hostname, url)`
  - Uses `getPluginName()` → `https://<plugin>.deno.dev${url.pathname}${url.search}`

### `src/utils/proxy.ts`
- `proxy(request, targetUrl, timeoutMs = 6000)`
  - Remove `host`, `origin`, `referer`, `cf-ray`, `cookie` headers.
  - Clone non‑GET/HEAD bodies before fetch.
  - Stream response as‑is; pass upstream headers/status through.

### `src/server.ts`
- `Deno.serve({ fetch: handle })`
- Router:
  - `/__health` → JSON ok
  - `/rpc/:chainId` (optional) → RPC handler
  - Default → compute target URL (service or plugin) and call `proxy`
- No cookies, no state, no KV reads/writes.

## Errors and Caching
- Errors: return upstream errors (404/5xx) as‑is. Optionally serve a static placeholder index for `/`.
- Caching: no edge persistence; let upstreams control via headers.

## Sitemaps (Optional)
- A) Static
  - Commit `public/sitemap.xml` and `public/sitemap.json` and serve as static files.
- B) Config‑driven
  - Commit `config/services.json` and `config/plugins.json`; generate on request with a small in‑memory TTL (no KV).

## Deployment (Deno + Cloudflare DNS)
1. Add `ubq.fi` and required subdomains in Deno Deploy → Domains.
2. Apply DNS in Cloudflare:
   - Apex: CNAME `ubq.fi` → Deno’s target with CNAME flattening.
   - Subdomains (e.g., `www`, `pay`): CNAME to Deno’s targets.
   - ACME verification records: `_acme-challenge.*` CNAME → set Proxy to “DNS only”.
3. Verify TLS in Deno Deploy (Provision Certificate if needed).

## Decommission Cloudflare Worker
- Remove zone routes for `ubq.fi/*` and `*.ubq.fi/*`.
- Optionally delete `ubq-fi-router` script to avoid accidental costs.

## Migration Steps
1. Implement minimal Deno app (`src/server.ts`, utils, optional RPC).
2. Add domains in Deno Deploy and set Cloudflare DNS records.
3. Verify apex/subdomains resolve from Deno.
4. Remove Cloudflare Worker routes.
5. Delete Cloudflare/KV/discovery code and dependencies from repo.
6. Update README/docs to Deno‑only.

## Acceptance Criteria
- All ubq.fi traffic serves from Deno Deploy.
- No KV calls, admin endpoints, or Pages/Workers fallbacks remain.
- Plugins resolve deterministically to `-main`/`-development` targets.
- RPC proxy (if kept) works without preflight for same‑origin calls.

## Future Enhancements (Optional)
- Local JSON config for sitemaps, search, or a services directory page.
- Lightweight request logging/metrics (e.g., simple console or third‑party ingest) without persistence.

## Examples
- `ubq.fi/` → `https://ubq-fi.deno.dev/`
- `pay.ubq.fi/api` → `https://pay-ubq-fi.deno.dev/api`
- `os-command-config.ubq.fi/manifest.json` →
  `https://command-config-main.deno.dev/manifest.json`
- `os-foo-development.ubq.fi/ping` →
  `https://foo-development.deno.dev/ping`
