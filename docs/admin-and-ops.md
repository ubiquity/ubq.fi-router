# Admin & Operations

This doc covers health checks, platform pinning, and seeding platform hints from GitHub.

## Health
- `GET /__health` → 200 JSON `{ status: 'ok', time: ... }`

## Platform Hint Admin (requires X-Admin-Token)
Set a secret once: `wrangler secret put ADMIN_TOKEN`.

- View: `GET /__platform?host=<host>`
- Set:  `POST /__platform?host=<host>&platform=deno|pages`
- Clear:`DELETE /__platform?host=<host>`

Notes:
- `<host>` must be `ubq.fi` or `*.ubq.fi`.
- Hints are per host; values are persisted to KV with a 30‑day TTL and cached in memory for 1h.

## Seed Hints from GitHub Discovery (requires X-Admin-Token)
Use when migrating or to pre‑pin platforms globally.

- `GET /__seed-lkg?which=services|plugins|all`
  - services: pins `service-deno → deno`, `service-pages|service-both → pages`.
  - plugins: pins `plugin-deno|plugin-both → deno`, `plugin-pages → pages`.

Under the hood, the worker calls discovery used by sitemaps:
- Services via `discoverAllServices`
- Plugins via `discoverAllPlugins`

## Runbooks
- “New host is 404ing intermittently” → set explicit platform via `/__platform` and investigate the upstream.
- “First request in a new region is slow” → run `/__seed-lkg?which=services|plugins|all` after a deployment wave.
- “Flipped a host from Pages to Deno” → POST `/__platform?host=...&platform=deno`.

## Files of Interest
- `src/worker.ts` (admin endpoints)
- `src/core/discovery.ts` (GitHub discovery used by seeding)

