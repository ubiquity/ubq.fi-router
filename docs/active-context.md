# Active Context

## Current Work Focus
1. ✅ **COMPLETED**: RPC routing implementation to eliminate CORS preflight requests
2. Enhancing plugin map discovery reliability
3. Improving sitemap generation performance

## Recent Changes
- **🚀 NEW: RPC Routing Implementation**
  - Added `/rpc/{chain_id}` route handling in `src/worker.ts`
  - Implements same-origin routing to eliminate 100ms+ preflight latency
  - Supports all HTTP methods (GET, POST, PUT, DELETE, OPTIONS)
  - Proper CORS headers and error handling
  - Successfully deployed and tested across multiple chains
- Created core documentation files:
  - `project-brief.md`
  - `product-context.md`
  - `system-patterns.md`
  - `tech-context.md`
- Updated deployment documentation with GitHub token setup

## Next Steps
1. Complete documentation updates for all core files
2. Refactor plugin map discovery to handle edge cases
3. Optimize sitemap generator for large datasets

## Active Decisions and Considerations
- **RPC Routing Strategy**: Same-origin requests via ubq.fi router to eliminate preflight requests
- Using Cloudflare KV for plugin map storage
- Adopting Hono for routing in Cloudflare Workers
- Prioritizing zero-configuration plugin discovery
- Maintaining strict performance budgets for all operations
