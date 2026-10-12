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
| pay.ubq.fi | Cloudflare worker `pay-ubq-fi`, cut over 2026-10-12 | root 200 `Ubiquity Rewards`, assets and SPA route 200; claim endpoint answers the documented `Supabase not configured` until `SUPABASE_SERVICE_ROLE_KEY` arrives |
| card.ubq.fi | Cloudflare worker `card-ubq-fi` (assets, SPA) | root 200 `Ubiquity Rewards | Ubiquity DAO`, deep-link 200 |
| keygen.ubq.fi | Cloudflare worker `keygen-ubq-fi` (assets, SPA) | root 200 `Key Generator`, deep-link 200 |
| work.ubq.fi | Cloudflare worker `work-ubq-fi` (assets, SPA) | root 200 `DevPool Directory | Ubiquity DAO`, deep-link 200 |
| partner.ubq.fi | Cloudflare worker `partner-ubq-fi` (Next.js static export, 404.html) | root 200, missing path 404 |
| health.ubq.fi | VPS `ubiquity-health.service` (8022) via the router | `/api/apps` `/` `/json` all 200 with `x-uos-router-origin: vps` |
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
- pay.ubq.fi is cut over: `SUPABASE_URL` is set (recovered from the estate's
  shared project), the UI/assets/SPA are live, and the ported claim handler
  (4/4 tests) is deployed. `SUPABASE_SERVICE_ROLE_KEY` remains with the owner;
  the anon key cannot substitute (a targeted no-op update proved RLS filters
  anonymous UPDATEs). A Pi/VPS sweep found no service-role key anywhere in the
  estate's env files.
- Repository CI (owner-approved replacement): the 11 Cloudflare-served repos now
  carry `.github/workflows/cloudflare-deploy.yml` instead of the dead Deno
  workflow. It runs on push and manually, builds (per-repo command and Supabase
  secrets), and deploys through `cloudflare/wrangler-action@v3` pinned to
  wrangler 4 — gated on the `CF_WORKERS_DEPLOY_TOKEN` secret, so runs stay green
  until a token with Workers Scripts:Edit for account `5c0228bee3…` is added.
  The org's existing `CLOUDFLARE_API_TOKEN` secret lacks that access ("No access
  to the specified service"), so it is not used. Manual `npx wrangler deploy`
  remains the documented path in each README.
- auth.ubq.fi, health.ubq.fi, and checkout.ubq.fi are VPS-hosted with no
  Cloudflare worker: their dead Deno workflows are left in place pending an
  explicit decision (their runbook is the VPS service list above).
- Deno-only leftovers retired on 2026-10-12: `RETIRE_DENO=1` makes the VPS the
  only origin for mapped hosts and answers `410 service_retired` for Deno-only
  hosts (previews, plugins, unmapped subdomains). No live path reaches Deno
  Deploy anymore; unsetting the flag restores the fallback if ever needed.

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

## Final sweep (2026-10-12, post-retirement)

All 15 migrated hosts return 200 and `rpc.ubq.fi` answers `eth_chainId`:

- 200: ubq.fi, auth.ubq.fi/health, ai.ubq.fi/health, app.prospector.sh/api/health,
  checkout.ubq.fi/api/health, health.ubq.fi/api/apps, stake, xp, notifications,
  demo, onboard, card, keygen, work, partner.
- rpc.ubq.fi POST /1 -> {"result":"0x1"}.
- pay.ubq.fi answers the router's 410 `service_retired` (the Deno app it used to
  reach is retired; the replacement worker is staged and waits on
  SUPABASE_SERVICE_ROLE_KEY). This is the only host not yet served.
