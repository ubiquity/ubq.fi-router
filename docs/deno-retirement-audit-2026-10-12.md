# Deno Deploy retirement audit and runbook - 2026-10-12

Deno announced on 2026-10-09 that the Deno team is joining Cloudflare: Deno
Deploy shuts down after six months (~2027-04-09) and Deno-led runtime
development ends after a year (~2027-10-09). The ubiquity-dao Deno Deploy
organisation was already suspended for a failed payment, so every host below
was returning 503 before this migration.

## Host status (all verified live)

| Host | Now served by | Evidence |
| --- | --- | --- |
| ubq.fi (apex) | Cloudflare worker `ubq-fi` (static assets + `/rpc/:chainId` + `/__health`) | root 200 `Ubiquity DAO`, 404.html for misses, `/rpc/1` -> `0x1`, `/rpc/10` -> `0xa` |
| auth.ubq.fi | VPS `ubiquity-auth.service` (8000) via the router, store on Cloudflare D1 (UBQ KV) | `/health` 200 `kv readable`, JWKS hash unchanged, login page 200 |
| ai.ubq.fi | VPS gateway via the router (`origin.ubq.fi`) | `/health` 200 with `x-uos-router-origin: vps` |
| app.prospector.sh | VPS Prospector (8010) | `/api/health` 200 |
| rpc.ubq.fi | VPS `ubiquity-rpc.service` (8020), DNS-only A record, Caddy TLS | `eth_chainId` 0x1/0xa, websocket 101, `/rpc/1` on the apex |
| checkout.ubq.fi | VPS `ubiquity-checkout.service` (8021) via the router, store on D1 (UBQ KV) | `/api/health` 200, JWKS signing key preserved |
| stake.ubq.fi | Cloudflare worker `stake-ubq-fi` (assets, SPA) | root/deep-link/assets 200 |
| xp.ubq.fi | Cloudflare worker `xp-ubq-fi` (assets + artifact API) | root/css/bundle/API shapes 200 |
| notifications.ubq.fi | Cloudflare worker `notifications-ubq-fi` (assets) | root/style/bundle/manifest 200 |
| demo.ubq.fi | Cloudflare worker `demo-ubq-fi` (assets, SPA) | root 200 `Demo | UbiquityOS`, `/dist/scripts/logger.js` 200 |
| onboard.ubq.fi | Cloudflare worker `onboard-ubq-fi` (assets, SPA) | root 200 `Onboarding | UbiquityOS`, `/dist/scripts/onboarding/onboarding.js` 200 |
| pay.ubq.fi | *staged*, not cut over: worker `pay-ubq-fi` on workers.dev | root/assets/SPA verified on workers.dev; `pay.ubq.fi` still 503 |
| card, keygen, partner, work | not migrated yet (static SPAs; builds need the shared Supabase values) | reachable only through the router's Deno fallback |
| health.ubq.fi | not migrated yet (dynamic server `src/server/index.ts`) | - |
| `os-*.ubq.fi` plugins | routed to `*.deno.dev` by the router | plugin deployments are gone (`DEPLOYMENT_NOT_FOUND`) |
| preview hosts (`preview-*`, `p-*`) | router Deno preview mapping | unused since the suspension |

## Decisions

- Static SPAs move to Cloudflare Workers static assets (free tier), each with its
  own zone route; they no longer need the router.
- The stateful/heavy apps (auth, ai, prospector, rpc, checkout) stay on the VPS.
  The router tries the VPS first (`VPS_ORIGIN_MAP` -> `origin.ubq.fi`, a DNS-only
  ingress) and falls back to Deno while it exists; `probe.ubq.fi` is a permanent
  failover canary.
- Shared state lives in one canonical store per app, reached by every tier:
  auth and checkout use the UBQ KV service (`kv.ubq.fi`, Cloudflare D1) with the
  `ubq-kv` worker; checkout's single production KV entry (its JWS signing key)
  and the auth hub's 117 entries were exported intact.
- pay.ubq.fi cutover is blocked on `SUPABASE_SERVICE_ROLE_KEY` (a Deno secret
  whose value the platform does not expose); the claim endpoint port follows.
- Deno-only leftovers to retire before 2027-04: the router's fallback leg for
  auth/ai/checkout, the Deno preview mapping, and plugin `*.deno.dev` hosting.

## Runbook

- Failover drill: `curl -s https://probe.ubq.fi/` must return
  `x-uos-router-failover: 1` with `x-uos-router-origin: deno` (primary fails by
  design through `origin.ubq.fi` -> 127.0.0.1:9).
- Router changes: edit `VPS_ORIGIN_MAP` in `wrangler.toml`, PR, merge, then
  `bun run cf:deploy`.
- VPS services: `ubiquity-auth`, `ubiquity-rpc`, `ubiquity-checkout`,
  `ubiquity-prospector`, `ai-ubq-fi` (system units); Caddy includes under
  `/etc/caddy/{rpc-ubq-fi,origin-ubq-fi}/Caddyfile`.
- KV service: `kv.ubq.fi` worker + D1 `ubiquity-auth`; client env is
  `*_KV_SERVICE_URL`/`*_KV_SERVICE_TOKEN` (auth, checkout) with a local sqlite
  or remote URL fallback.
- Rollbacks: router deploys are versioned in Cloudflare; VPS services can be
  stopped per unit; the auth hub keeps `/var/lib/ubiquity-auth/kv.sqlite3` as its
  pre-D1 snapshot.
