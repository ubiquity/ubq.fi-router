# UBQ.FI Router - TypeScript Setup

A Cloudflare Worker that routes requests from ubq.fi domains to either Deno Deploy or Cloudflare Pages with intelligent caching and service discovery.

## Overview

This Cloudflare Worker routes requests from ubq.fi domains to either:
1. **Deno Deploy** (prioritized) - *.deno.dev
2. **Cloudflare Pages** (fallback) - *.pages.dev

### Caching Strategy
- Uses Cloudflare KV to cache service discovery results
- Cache keys are based on subdomain patterns (e.g., "pay", "beta.pay", "")
- Cache values indicate which services exist: "deno", "pages", "both", or "none"
- TTL: 1 hour for existing services, 5 minutes for non-existent (negative caching)

### Performance Optimizations
- Parallel service discovery checks
- Request coalescing to prevent duplicate discoveries
- Negative caching for 404 responses

### Routing Logic
1. Parse incoming domain (ubq.fi, pay.ubq.fi, beta.pay.ubq.fi)
2. Check cache control headers
3. If refresh/clear: skip cache and discover services
4. If normal request: check KV cache first
5. Try Deno Deploy first, fallback to Cloudflare Pages
6. Cache the discovery result for future requests
7. Forward request to the available service

## Setup

### Prerequisites
- [Bun](https://bun.sh/) installed
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- Cloudflare account with Workers and KV access

### Installation

1. Install dependencies:
```bash
bun install
```

2. Configure your KV namespace in `wrangler.toml`:
   - Update the `id` field with your production KV namespace ID
   - Update the `preview_id` field with your preview KV namespace ID

### Development

#### Build the worker:
```bash
bun run build
```

#### Type checking:
```bash
bun run type-check
```

#### Local development:
```bash
bun run dev
```

#### Deploy to Cloudflare:
```bash
bun run deploy
```

## Project Structure

```
src/
├── worker.ts           # Main worker entry point
├── types.ts           # TypeScript type definitions
├── utils.ts           # URL building and subdomain utilities
├── service-discovery.ts # Service discovery and coalescing logic
└── routing.ts         # Request routing and proxying
```

## Configuration

### wrangler.toml
Update your `wrangler.toml` with your actual KV namespace IDs:

```toml
[[kv_namespaces]]
binding = "ROUTER_CACHE"
id = "your-actual-kv-namespace-id"
preview_id = "your-actual-preview-kv-namespace-id"
```

### Environment Setup
The worker expects a KV namespace binding called `ROUTER_CACHE` for caching service discovery results.

## Usage

### Cache Control Headers

- `X-Cache-Control: refresh` - Bypasses cache and rediscovers services
- `X-Cache-Control: clear` - Removes cache entry entirely

### Deployment Debugging Workflow

1. Deploy new service to Deno Deploy
2. Test with cache refresh: `curl -H "X-Cache-Control: refresh" https://newservice.ubq.fi`
3. Cache is updated, subsequent requests route correctly

## Architecture

The router follows this flow:
1. Parse incoming domain (ubq.fi, pay.ubq.fi, beta.pay.ubq.fi)
2. Check cache control headers
3. If refresh/clear: skip cache and discover services
4. If normal request: check KV cache first
5. Try Deno Deploy first, fallback to Cloudflare Pages
6. Cache the discovery result for future requests
7. Forward request to the available service

## Performance Features

- **Parallel service discovery**: Checks both Deno Deploy and Cloudflare Pages simultaneously
- **Request coalescing**: Prevents duplicate discoveries for the same subdomain
- **Intelligent caching**: 1 hour TTL for existing services, 5 minutes for 404s
- **Streaming responses**: No buffering for optimal performance
