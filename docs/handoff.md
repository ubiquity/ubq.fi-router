# Handoff for Next LLM Maintainer

This is a concise, actionable context pack to continue work safely.

## Current State
- Router serves `ubq.fi/*` and `*.ubq.fi/*` via Workers. Entry: `src/worker.ts`.
- Upstream selection: `src/routing.ts` with sticky hints (cookie + LKG), fallbacks, and hedged GET/HEAD.
- Hints: `src/core/last-known-good.ts` (memory + KV persistence). KV namespace bound as `ROUTER_CACHE`.
- Admin endpoints (require `X-Admin-Token`): `/__platform`, `/__seed-lkg`, health at `/__health`.
- Discovery for seeding: `src/core/discovery.ts` (also used by sitemaps/plugin-map).
 - Circuit breaker: in-memory per host+platform; opens after 3 consecutive 5xx/timeout within ~60s and suppresses as primary for ~60s. Files: `src/core/circuit-breaker.ts` and integration in `src/routing.ts`.

## Guarantees & Constraints
- Keep per‑request KV at zero on hot path. Hints: memory first, KV only on cold reads/changes.
- Do not forward `Cookie` to upstream; set `ubqpf` on success (24h) for sticky routing.
- Hedging: only for GET/HEAD and unknown primaries; retain 250ms delay and 6s timeout.
- Default preferences: services → Pages-first, plugins → Deno-first.

## Operations
- View/set/clear hint: `/__platform?host=<host>` with `X-Admin-Token`.
- Pre‑seed hints from GitHub: `/__seed-lkg?which=services|plugins|all`.
- Health: `/__health`.

## Safe Tasks You Can Pick Up
- Tune circuit breaker thresholds/durations or add admin introspection (`/__breaker?host=<host>`).
- Tune hedging delay/timeout per host based on observed latency (log + tail).
- Expand seeding to optionally pin service-both as deno if migration reaches a given milestone.

## Code Map
- `src/worker.ts` — request entry; cache controls; health & admin endpoints.
- `src/routing.ts` — selection logic, fallback policy, hedging, cookie handling, proxy.
- `src/core/last-known-good.ts` — memory + KV hint reads/writes.
- `src/core/memory-cache.ts` — in‑isolate TTL caches.
- `src/core/discovery.ts` — discovery used by seeding and sitemaps.

## Testing Checklist
- curl `https://ubq.fi/__health` → 200 JSON.
- curl `https://ubq.fi` and confirm 200 and optional `Set-Cookie: ubqpf` on first hits.
- Post `X-Admin-Token` to `/__platform?host=pay.ubq.fi&platform=deno` and reload `https://pay.ubq.fi`.
- Seed: `/__seed-lkg?which=all` (with header), then verify `/__platform?host=<host>` shows expected.

## Known Trade‑offs
- Hedging can start a second upstream request under cold conditions; mitigated by cookie + LKG and short delay.
- LKG KV R/W are best‑effort; routing remains correct via cookie + active fallbacks.

## Links
- See docs in `docs/`:
  - routing-and-fallbacks.md — selection/hedging details
  - kv-and-hints.md — KV budget & design
  - admin-and-ops.md — runbooks & endpoints
  - endpoints.md — public API summary
  - migration-strategy.md — Pages→Deno notes
