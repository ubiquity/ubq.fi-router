# Public Endpoints & Headers

## Routing
- General traffic is handled at `ubq.fi/*` and `*.ubq.fi/*` via zone routes.
- Plugin hosts: `os-*.ubq.fi`.

## Special Paths
- `GET /__health` → 200 JSON
- `GET /sitemap.xml`, `GET /sitemap.json`
- `GET /plugin-map.xml`, `GET /plugin-map.json`
- `GET /rpc/<chainId>` (proxied to `https://rpc.ubq.fi/<chainId>`) with CORS headers

## Admin Paths (require `X-Admin-Token`)
- `GET /__platform?host=<host>` → view current hint
- `POST /__platform?host=<host>&platform=deno|pages` → set hint
- `DELETE /__platform?host=<host>` → clear hint
- `GET /__seed-lkg?which=services|plugins|all` → pre‑pin hints from GitHub discovery

## Request Headers Used
- Input: `X-Cache-Control: refresh|clear|clear-all`
- Admin: `X-Admin-Token: <secret>`

## Proxy Header Rules
- Dropped to upstream: `host`, `origin`, `referer`, `cookie`, `cf-ray`
- Added on hedged responses: `x-upstream-platform: deno|pages`

## Sticky Cookie
- `Set-Cookie: ubqpf=deno|pages; Max-Age=86400; Path=/; Domain=<host>; Secure; SameSite=Lax`
- Not forwarded to upstream.

