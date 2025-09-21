# KV Usage and Platform Hints

Goals: stay within Cloudflare KV free tier while keeping routing fast and stable.

## KV Budget (Free Tier, indicative)
- Reads: ~100k/day, Writes/Deletes/List: ~1k/day, Storage: ~1 GB.
- Router design avoids per‑request KV; reads happen only on cold isolates, writes happen only on platform flips.

## Hints Data Model
- Keys: `lkg:service:<subdomain>` and `lkg:plugin:<hostname>` → value `deno|pages`.
- TTL: 30 days. Updated only on change to minimize writes.

## Read Path
1) Cookie `ubqpf` (from client) 2) Memory LKG (1h per isolate) 3) KV LKG (cold only).

## Write Path
- On a successful fallback or first success for an unknown host, update memory LKG.
- If the platform differs from the last stored value, write to KV with long TTL.

## Discovery Caches
- Sitemaps/plugin-map use KV with long TTLs; routing hot path avoids KV.

## Files of Interest
- `src/core/last-known-good.ts` (read/write logic)
- `src/core/memory-cache.ts` (in‑isolate caches)

