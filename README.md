# UBQ.FI Router - TypeScript Cloudflare Worker

A high-performance Cloudflare Worker that intelligently routes requests from ubq.fi domains to either Deno Deploy or Cloudflare Pages with advanced caching, service discovery, and request coalescing.

## 🎯 Overview

This TypeScript-based Cloudflare Worker provides:
- **Intelligent Routing**: Automatically routes requests to available services
- **Performance Optimization**: Request coalescing, parallel discovery, and streaming responses
- **Advanced Caching**: KV-based service discovery caching with intelligent TTL
- **Professional Development**: Full TypeScript setup with modular architecture
- **Debug-Friendly**: Comprehensive cache control and monitoring capabilities

## 🏗️ Architecture

### Service Priority
1. **Deno Deploy** (Primary) - `*.deno.dev`
2. **Cloudflare Pages** (Fallback) - `*.pages.dev`

### URL Mapping Examples
| Domain | Deno Deploy | Cloudflare Pages |
|--------|-------------|------------------|
| `ubq.fi` | `ubq-fi.deno.dev` | `ubq-fi.pages.dev` |
| `pay.ubq.fi` | `pay-ubq-fi.deno.dev` | `pay-ubq-fi.pages.dev` |
| `beta.pay.ubq.fi` | `beta-pay-ubq-fi.deno.dev` | `beta.pay-ubq-fi.pages.dev` |

### Caching Strategy
- **Cache Keys**: Based on subdomain patterns (`"pay"`, `"beta.pay"`, `""`)
- **Cache Values**: Service availability (`"deno"`, `"pages"`, `"both"`, `"none"`)
- **TTL Strategy**: 1 hour for existing services, 5 minutes for non-existent
- **Negative Caching**: Prevents repeated failed discoveries

### Performance Features
- **Parallel Discovery**: Checks both services simultaneously
- **Request Coalescing**: Prevents duplicate discoveries for same subdomain
- **Streaming Responses**: No buffering for optimal performance
- **Intelligent Fallback**: Deno Deploy → Cloudflare Pages → 404

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) runtime
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account with Workers and KV access

### Installation
```bash
# Clone and install
bun install

# Configure KV namespace in wrangler.toml
# (Update with your actual KV namespace IDs)

# Build and deploy
bun run deploy
```

## 📋 Commands Reference

| Command | Description |
|---------|-------------|
| `bun run build` | Build TypeScript to JavaScript |
| `bun run type-check` | TypeScript type checking |
| `bun run dev` | Local development server |
| `bun run deploy` | Build and deploy to Cloudflare |

## 🗂️ Project Structure

```
src/
├── worker.ts              # Main worker entry point
├── types.ts              # TypeScript type definitions
├── utils.ts              # URL building utilities
├── service-discovery.ts  # Service discovery logic
└── routing.ts           # Request routing and proxying

dist/                     # Built output (auto-generated)
├── worker.js            # Bundled worker

docs/                     # Documentation
├── architecture.md      # System architecture details
├── api-reference.md     # API and cache control reference
├── troubleshooting.md   # Common issues and solutions
└── deployment.md        # Deployment guide
```

## ⚙️ Configuration

### wrangler.toml
```toml
name = "ubq-fi-router"
main = "dist/worker.js"
compatibility_date = "2023-12-01"

[[kv_namespaces]]
binding = "ROUTER_CACHE"
id = "your-kv-namespace-id-here"
preview_id = "your-preview-kv-namespace-id-here"

[build]
command = "bun run build"
```

### Environment Variables
- **ROUTER_CACHE**: KV namespace binding for caching

## 🎛️ Cache Control API

### Headers
| Header Value | Action |
|--------------|--------|
| `X-Cache-Control: refresh` | Bypass cache and rediscover services |
| `X-Cache-Control: clear` | Remove single cache entry |
| `X-Cache-Control: clear-all` | Remove ALL cache entries |

### Usage Examples
```bash
# Refresh single service discovery
curl -H "X-Cache-Control: refresh" https://pay.ubq.fi

# Clear specific cache entry
curl -H "X-Cache-Control: clear" https://blog.ubq.fi

# Clear entire cache
curl -H "X-Cache-Control: clear-all" https://ubq.fi
```

## 🔧 Development Workflow

### Local Development
```bash
# Start development server
bun run dev

# In another terminal, test locally
curl http://localhost:8787 -H "Host: pay.ubq.fi"
```

### Deployment Process
```bash
# Type check
bun run type-check

# Build
bun run build

# Deploy
bun run deploy
```

### Debugging New Services
1. Deploy service to Deno Deploy or Cloudflare Pages
2. Force cache refresh: `curl -H "X-Cache-Control: refresh" https://newservice.ubq.fi`
3. Verify routing with normal request: `curl https://newservice.ubq.fi`

## 📊 Monitoring

### KV Cache Inspection
Check your Cloudflare KV namespace for cache entries:
- Keys follow pattern: `route:{subdomain}`
- Values: `"deno"`, `"pages"`, `"both"`, or `"none"`

### Performance Metrics
- **Bundle Size**: ~4.6kb (optimized)
- **Cache TTL**: 1 hour (success), 5 minutes (404)
- **Timeout**: 3 seconds per service check
- **Coalescing**: Prevents duplicate requests

## 🔍 Troubleshooting

### Common Issues

**Service shows as available but returns 404**
- Check if the actual service URL exists
- Verify URL building logic in `src/utils.ts`
- Clear cache and refresh: `curl -H "X-Cache-Control: clear" https://domain.ubq.fi`

**Cache not updating**
- Use `X-Cache-Control: refresh` to force update
- Check KV namespace configuration
- Verify cache TTL settings

**Build failures**
- Run `bun run type-check` for TypeScript errors
- Ensure all dependencies are installed: `bun install`
- Check esbuild configuration in `package.json`

See [docs/troubleshooting.md](docs/troubleshooting.md) for detailed solutions.

## 📚 Documentation

- [Architecture Details](docs/architecture.md) - System design and data flow
- [API Reference](docs/api-reference.md) - Complete API documentation
- [Deployment Guide](docs/deployment.md) - Production deployment
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

## 🤝 Contributing

1. Make changes to TypeScript files in `src/`
2. Run type checking: `bun run type-check`
3. Test locally: `bun run dev`
4. Deploy: `bun run deploy`

## 📄 License

[Your License Here]

---

**Need Help?** Check the [troubleshooting guide](docs/troubleshooting.md) or review the [architecture documentation](docs/architecture.md).
