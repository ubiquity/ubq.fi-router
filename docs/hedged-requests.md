# Hedged Requests

Hedging launches a secondary upstream request after a short delay and returns the first successful response. This reduces tail latency for cold paths.

## When Used
- Only for GET/HEAD
- Only when the platform is unknown (no cookie, no LKG)
- service-both and plugin-both cases

## Parameters
- Hedge delay: ~250ms
- Per-request upstream timeout: 6s

## Behavior
- Start primary, and after the delay start fallback if primary hasn’t responded yet.
- Return the first response that isn’t 404 and <500.
- Add `x-upstream-platform` header to the response to record which origin won.

## Files
- `src/routing.ts` (hedgedProxy and integration points)

