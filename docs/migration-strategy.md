# Pages → Deno Migration Strategy

Context: We are slowly migrating services from Cloudflare Pages to Deno Deploy.

## Recommended Process
1) Deploy the Deno version of a service.
2) Seed LKG hints for services/plugins using `/__seed-lkg?which=services|plugins|all`.
3) For specific hosts, explicitly set platform via `/__platform?host=<host>&platform=deno`.
4) Monitor for 5xx/latency; router auto‑falls back to Pages if needed and preserves availability.

## Why it’s Safe
- Router defaults to Pages-first for services when unknown, then learns Deno.
- Cookie + LKG ensure asset bursts go straight to the correct origin.
- Hedging reduces cold-edge latency without affecting hot paths.

## Rollback
- `/__platform?host=<host>&platform=pages` to force Pages.
- Clear hint with `DELETE /__platform?host=<host>` to return to auto‑detect.

## Observability Tips
- `wrangler tail` to spot fallbacks and success logs.
- Use `/__health` for uptime monitors.

