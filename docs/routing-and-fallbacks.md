# Routing, Sticky Hints, Fallbacks, Hedging

This document explains how the router selects the upstream (Deno vs Pages), how it avoids slow paths, and how it fails over reliably.

## Selection Order
- Services (e.g., `ubq.fi`, `pay.ubq.fi`): Pages first, then Deno on error.
- Plugins (`os-*.ubq.fi`): Deno first, then Pages on error.

## Sticky Hints (ubqpf + LKG)
- Cookie `ubqpf=deno|pages` is set per host on a successful response (Max‑Age 86400s).
- Last‑Known‑Good (LKG) is stored in memory for 1h and persisted to KV for 30d only when the detected platform changes.
- The request flow uses: cookie → memory LKG → KV LKG (cold isolate only) → default + fallback.

## Fast Fallbacks
- On 404/5xx/timeout (6s) the router immediately switches to the alternate platform.
- Headers `host`, `origin`, `referer`, `cookie`, `cf-ray` are stripped when proxying upstream to avoid issues.

## Hedged Requests (GET/HEAD only)
- For unknown hosts (no cookie/LKG), the router can “hedge” by starting the primary upstream and then launching the fallback after ~250ms in parallel. It returns whichever succeeds first.
- Hedging is used for service-both and plugin-both when primary is unknown and method is GET/HEAD. It’s disabled for mutating methods.

## Files of Interest
- `src/routing.ts` (core selection, fallback, hedging, cookie handling)
- `src/core/last-known-good.ts` (memory + KV LKG hints)

