# Deployment Guide

## Overview

This guide covers the complete deployment process for the UBQ.FI Router, from initial setup to production deployment and ongoing maintenance.

## Prerequisites

### Required Tools
- **Bun**: JavaScript runtime and package manager
- **Wrangler CLI**: Cloudflare Workers deployment tool
- **Git**: Version control (recommended)
- **curl**: For testing (optional but recommended)

### Installation Commands
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Wrangler globally
npm install -g wrangler
# or
bun install -g wrangler

# Verify installations
bun --version
wrangler --version
```

### Cloudflare Account Setup
1. Create Cloudflare account at https://cloudflare.com
2. Add your domain (ubq.fi) to Cloudflare
3. Enable Workers on your account
4. Generate API token with Workers edit permissions

## Initial Setup

### 1. Project Setup
```bash
# Clone or create project directory
git clone <repository-url>
cd ubq.fi-router

# Install dependencies
bun install
```

### 2. Cloudflare Authentication
```bash
# Interactive login
wrangler login

# Or use API token
export CLOUDFLARE_API_TOKEN=your-token-here
```

### 3. KV Namespace Creation
```bash
# Create production KV namespace
wrangler kv:namespace create "ROUTER_CACHE"

# Create preview KV namespace for development
wrangler kv:namespace create "ROUTER_CACHE" --preview
```

**Sample Output:**
```
 ⛅️ wrangler 3.114.9
-------------------

🌀 Creating namespace with title "ubq-fi-router-ROUTER_CACHE"
✨ Success! Created KV namespace with id "01f073a865f742088b1d8c7dd348442b"
📋 Add the following to your wrangler.toml:
```

### 4. Configuration Update
Update `wrangler.toml` with your actual namespace IDs:

```toml
name = "ubq-fi-router"
main = "dist/worker.js"
compatibility_date = "2023-12-01"

[[kv_namespaces]]
binding = "ROUTER_CACHE"
id = "01f073a865f742088b1d8c7dd348442b"
preview_id = "01f073a865f742088b1d8c7dd348442b"

[build]
command = "bun run build"

[vars]
# Environment variables (if needed)
```

## Development Deployment

### Local Development
```bash
# Start local development server
bun run dev

# In another terminal, test locally
curl http://localhost:8787 -H "Host: pay.ubq.fi"
```

### Development Testing
```bash
# Test TypeScript compilation
bun run type-check

# Build for production
bun run build

# Test built output
ls -la dist/
```

## Production Deployment

### Pre-Deployment Checklist
- [ ] All TypeScript errors resolved
- [ ] KV namespaces configured in wrangler.toml
- [ ] Authentication set up (logged in or API token)
- [ ] Build process successful
- [ ] Local testing completed

### Deployment Command
```bash
# Single command deployment
bun run deploy
```

This runs:
1. `bun run build` - TypeScript compilation and bundling
2. `wrangler deploy` - Upload to Cloudflare Workers

### Deployment Output
```
bun run build && wrangler deploy
esbuild src/worker.ts --bundle --outfile=dist/worker.js --format=esm --target=es2022

  dist/worker.js  4.6kb

⚡ Done in 11ms

 ⛅️ wrangler 3.114.9
--------------------------------------------------------

Total Upload: 5.07 KiB / gzip: 1.49 KiB
Your worker has access to the following bindings:
- KV Namespaces:
  - ROUTER_CACHE: 01f073a865f742088b1d8c7dd348442b
Uploaded ubq-fi-router (2.38 sec)
Deployed ubq-fi-router triggers (0.32 sec)
  https://ubq-fi-router.ubq.workers.dev
Current Version ID: 3e13008d-fd51-4b58-ad0e-a671d02e82b1
```

## Post-Deployment Verification

### 1. Basic Functionality Test
```bash
# Test cache control
curl -H "X-Cache-Control: clear-all" https://ubq.fi

# Test service discovery
curl -H "X-Cache-Control: refresh" https://pay.ubq.fi

# Test normal routing
curl https://pay.ubq.fi

# Test plugin routing
curl -H "X-Cache-Control: refresh" https://os-command-config.ubq.fi
curl https://os-command-config.ubq.fi/manifest.json
```

### 2. Service Discovery Verification
```bash
# Check individual services
curl -I https://pay-ubq-fi.deno.dev
curl -I https://pay-ubq-fi.pages.dev

# Verify worker routing
curl -v https://pay.ubq.fi
```

### 3. Cache Functionality
```bash
# Clear cache and monitor
curl -H "X-Cache-Control: clear-all" https://ubq.fi
# Should return: "Cleared N cache entries"

# Force discovery
curl -H "X-Cache-Control: refresh" https://pay.ubq.fi
# Should work and cache the result

# Verify cache hit
curl https://pay.ubq.fi
# Should be fast (cache hit)
```

## DNS Configuration

### Cloudflare DNS Setup
1. **Log in to Cloudflare Dashboard**
2. **Select your domain** (ubq.fi)
3. **Go to DNS** → **Records**
4. **Add/Update records:**

#### Root Domain
```
Type: CNAME
Name: ubq.fi
Content: ubq-fi-router.ubq.workers.dev
Proxy status: Proxied (orange cloud)
```

#### Subdomains
```
Type: CNAME
Name: *
Content: ubq-fi-router.ubq.workers.dev
Proxy status: Proxied (orange cloud)
```

#### Specific Subdomains (Alternative)
```
Type: CNAME
Name: pay
Content: ubq-fi-router.ubq.workers.dev
Proxy status: Proxied (orange cloud)

Type: CNAME
Name: blog
Content: ubq-fi-router.ubq.workers.dev
Proxy status: Proxied (orange cloud)
```

### DNS Propagation
- **Propagation time**: Usually 2-5 minutes with Cloudflare
- **Verification**: Use `dig` or online DNS checkers
- **Testing**: `curl https://pay.ubq.fi -v`

## Environment Management

### Production Environment
```toml
# wrangler.toml
name = "ubq-fi-router"
main = "dist/worker.js"
compatibility_date = "2023-12-01"

[[kv_namespaces]]
binding = "ROUTER_CACHE"
id = "production-kv-namespace-id"
```

### Staging Environment
```toml
# wrangler.staging.toml
name = "ubq-fi-router-staging"
main = "dist/worker.js"
compatibility_date = "2023-12-01"

[[kv_namespaces]]
binding = "ROUTER_CACHE"
id = "staging-kv-namespace-id"
```

**Staging Deployment:**
```bash
wrangler deploy --config wrangler.staging.toml
```

## Monitoring Setup

### Cloudflare Workers Analytics
1. **Navigate to Workers** → **Your Worker** → **Metrics**
2. **Monitor metrics:**
   - Request volume
   - Error rate
   - Response time
   - CPU time usage

### KV Usage Monitoring
1. **Navigate to KV** → **Your Namespace** → **Metrics**
2. **Monitor:**
   - Read operations
   - Write operations
   - Storage usage

### Custom Monitoring
```bash
# Health check script
#!/bin/bash
DOMAINS=("ubq.fi" "pay.ubq.fi" "blog.ubq.fi")

for domain in "${DOMAINS[@]}"; do
  status=$(curl -o /dev/null -s -w "%{http_code}" "https://$domain")
  echo "$domain: $status"
done
```

## Rollback Procedures

### Quick Rollback
```bash
# Deploy previous version
git checkout HEAD~1
bun run deploy

# Or deploy specific commit
git checkout <commit-hash>
bun run deploy
```

### Emergency DNS Rollback
1. **Change DNS records** to point directly to service
2. **Bypass worker** temporarily
3. **Fix issue** and redeploy
4. **Restore DNS** to worker

## Maintenance

### Regular Tasks

#### Weekly
- [ ] Check error rates in Cloudflare dashboard
- [ ] Monitor KV storage usage
- [ ] Review worker performance metrics

#### Monthly
- [ ] Update dependencies: `bun update`
- [ ] Check for Wrangler updates: `wrangler --version`
- [ ] Review and clean up old KV entries if needed

#### As Needed
- [ ] Clear cache during service updates
- [ ] Update DNS records for new services
- [ ] Deploy code updates

### Cache Management
```bash
# Regular cache clearing for updates
curl -H "X-Cache-Control: clear-all" https://ubq.fi

# Targeted cache refresh
curl -H "X-Cache-Control: refresh" https://newservice.ubq.fi
```

## Scaling Considerations

### Automatic Scaling
- **Cloudflare Workers** automatically scale with traffic
- **No server management** required
- **Global edge deployment** handles geographic distribution

### Performance Optimization
- **Monitor bundle size**: Keep under 10MB (current: ~4.6kb)
- **Optimize KV usage**: Efficient cache keys and TTL
- **Request coalescing**: Already implemented

### Cost Management
- **Workers**: $5/month for 10M requests
- **KV**: $0.50/GB storage + operations
- **Monitor usage** in Cloudflare dashboard

## Security

### Production Security Checklist
- [ ] API tokens have minimal required permissions
- [ ] KV namespaces are not publicly accessible
- [ ] Worker code doesn't log sensitive data
- [ ] DNS records are properly configured
- [ ] HTTPS is enforced (automatic with Cloudflare)

### Access Control
```bash
# Restrict API token permissions to:
# - Workers:Edit
# - KV:Edit (specific namespaces only)
# - DNS:Edit (if managing DNS via API)
```

## Troubleshooting Deployment

### Common Deployment Errors

#### Authentication Errors
```bash
# Error: Not authenticated
wrangler login
# or
export CLOUDFLARE_API_TOKEN=your-token
```

#### KV Namespace Errors
```bash
# Error: KV namespace not found
# Check wrangler.toml has correct namespace ID
# Recreate if necessary:
wrangler kv:namespace create "ROUTER_CACHE"
```

#### Build Errors
```bash
# Error: TypeScript compilation failed
bun run type-check

# Error: Module not found
bun install
```

### Deployment Health Check
```bash
#!/bin/bash
# deployment-health-check.sh

echo "Checking deployment health..."

# Test basic functionality
echo "Testing cache control..."
CLEAR_RESULT=$(curl -s -H "X-Cache-Control: clear-all" https://ubq.fi)
echo "Clear result: $CLEAR_RESULT"

# Test service discovery
echo "Testing service discovery..."
curl -H "X-Cache-Control: refresh" https://pay.ubq.fi > /dev/null
echo "Service discovery: OK"

# Test routing
echo "Testing routing..."
STATUS=$(curl -o /dev/null -s -w "%{http_code}" https://pay.ubq.fi)
echo "Routing status: $STATUS"

echo "Deployment health check complete"
```

## Continuous Deployment

### GitHub Actions Example
```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Type check
        run: bun run type-check

      - name: Build
        run: bun run build

      - name: Deploy to Cloudflare Workers
        run: bun run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

This deployment guide provides complete instructions for setting up, deploying, and maintaining the UBQ.FI Router in production environments.
