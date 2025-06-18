# Troubleshooting Guide

## Common Issues

### Service Shows as Available but Returns 404

**Symptoms:**
- KV cache shows service as `"pages"` or `"deno"`
- Accessing the domain returns "Service not found" or 404
- Cache appears to be incorrect

**Causes:**
1. **Stale cache data** - Service was removed but cache not updated
2. **URL building error** - Incorrect service URL generation
3. **Service temporarily down** - Service exists but currently unavailable

**Solutions:**

1. **Clear and refresh cache:**
   ```bash
   curl -H "X-Cache-Control: clear" https://problematic-domain.ubq.fi
   curl -H "X-Cache-Control: refresh" https://problematic-domain.ubq.fi
   ```

2. **Verify URL building logic:**
   - Check `src/utils.ts` for correct URL patterns
   - Manually test service URLs:
     ```bash
     curl -I https://subdomain-ubq-fi.deno.dev
     curl -I https://subdomain-ubq-fi.pages.dev
     ```

3. **Check service status:**
   - Verify Deno Deploy deployment status
   - Check Cloudflare Pages build logs
   - Confirm DNS configuration

### Cache Not Updating

**Symptoms:**
- Using `X-Cache-Control: refresh` but cache doesn't change
- New services not being detected
- KV store shows old values

**Causes:**
1. **KV propagation delay** - Changes take time to propagate globally
2. **Request coalescing** - Multiple requests sharing one discovery
3. **Service discovery errors** - Network issues preventing updates

**Solutions:**

1. **Force cache clearing:**
   ```bash
   # Clear all cache entries
   curl -H "X-Cache-Control: clear-all" https://ubq.fi

   # Wait a moment, then refresh
   sleep 5
   curl -H "X-Cache-Control: refresh" https://target-domain.ubq.fi
   ```

2. **Check KV namespace configuration:**
   - Verify `wrangler.toml` has correct KV namespace IDs
   - Ensure KV namespace exists in Cloudflare dashboard
   - Check worker has proper KV bindings

3. **Monitor discovery process:**
   ```bash
   # Check if services are actually reachable
   curl -I https://subdomain-ubq-fi.deno.dev
   curl -I https://subdomain-ubq-fi.pages.dev
   ```

### Build Failures

**Symptoms:**
- `bun run build` fails with errors
- TypeScript compilation errors
- Missing dependencies

**Common Error Messages:**

#### "Cannot find module" errors
```
Error: Cannot find module './types'
```

**Solution:**
```bash
# Check file extensions and imports
# Ensure imports don't use .js/.ts extensions
# Example: import from './types' not './types.ts'
```

#### "Cannot find name 'KVNamespace'"
```
Cannot find name 'KVNamespace'
```

**Solution:**
```bash
# Install Cloudflare Workers types
bun install @cloudflare/workers-types

# Check tsconfig.json includes workers types
```

#### esbuild bundling errors
```
Build failed with 1 error
```

**Solutions:**
1. **Check TypeScript errors first:**
   ```bash
   bun run type-check
   ```

2. **Verify package.json build script:**
   ```json
   {
     "scripts": {
       "build": "esbuild src/worker.ts --bundle --outfile=dist/worker.js --format=esm --target=es2022"
     }
   }
   ```

3. **Clear node_modules and reinstall:**
   ```bash
   rm -rf node_modules bun.lock
   bun install
   ```

### Deployment Issues

**Symptoms:**
- `bun run deploy` fails
- Worker uploads but doesn't work
- KV binding errors

**Common Issues:**

#### KV Namespace Errors
```
KV namespace 'your-kv-namespace-id-here' is not valid
```

**Solution:**
1. Update `wrangler.toml` with actual KV namespace ID:
   ```toml
   [[kv_namespaces]]
   binding = "ROUTER_CACHE"
   id = "01f073a865f742088b1d8c7dd348442b"
   preview_id = "01f073a865f742088b1d8c7dd348442b"
   ```

2. Create KV namespace if it doesn't exist:
   ```bash
   wrangler kv:namespace create "ROUTER_CACHE"
   wrangler kv:namespace create "ROUTER_CACHE" --preview
   ```

#### Authentication Errors
```
Error: Not authenticated
```

**Solution:**
```bash
# Login to Cloudflare
wrangler login

# Or use API token
export CLOUDFLARE_API_TOKEN=your-token-here
```

#### Worker Name Conflicts
```
Error: Script name already exists
```

**Solution:**
- Change `name` in `wrangler.toml` to unique value
- Or delete existing worker in Cloudflare dashboard

### Local Development Issues

**Symptoms:**
- `bun run dev` fails to start
- Worker doesn't respond to requests
- CORS errors

**Solutions:**

#### Wrangler Dev Server Issues
```bash
# Check if port is available
lsof -i :8787

# Use different port
wrangler dev --port 3000

# Check for wrangler version issues
wrangler --version
```

#### Local Testing
```bash
# Test with proper Host header
curl http://localhost:8787 -H "Host: pay.ubq.fi"

# Check worker logs
# Logs appear in terminal running `bun run dev`
```

### Service Discovery Issues

**Symptoms:**
- Services exist but not detected
- Inconsistent detection results
- Timeout errors

**Debugging Steps:**

1. **Manual service testing:**
   ```bash
   # Test exact URLs the worker uses
   curl -I https://pay-ubq-fi.deno.dev
   curl -I https://pay-ubq-fi.pages.dev

   # Check response codes
   curl -w "%{http_code}" -o /dev/null -s https://pay-ubq-fi.deno.dev
   ```

2. **Check timeout settings:**
   - Current timeout: 3 seconds
   - Located in `src/service-discovery.ts`
   - Increase if needed for slow services

3. **Verify URL building:**
   ```bash
   # Check logs during discovery
   # Add console.log in development
   ```

### Performance Issues

**Symptoms:**
- Slow response times
- Timeout errors
- High memory usage

**Optimization Steps:**

1. **Cache hit ratio:**
   - Monitor KV dashboard for cache statistics
   - Ensure TTL values are appropriate
   - Check for cache thrashing

2. **Service discovery optimization:**
   ```typescript
   // Verify parallel discovery is working
   const [denoExists, pagesExists] = await Promise.all([
     serviceExists(denoUrl),
     serviceExists(pagesUrl)
   ])
   ```

3. **Request coalescing:**
   - Multiple requests to same domain should share discovery
   - Check `inFlightDiscoveries` map usage

### Domain Routing Issues

**Symptoms:**
- Wrong service being selected
- Fallback not working
- Incorrect URL generation

**Debugging:**

1. **Check subdomain parsing:**
   ```bash
   # Verify getSubdomainKey function
   # Test with different domain patterns:
   # ubq.fi → ""
   # pay.ubq.fi → "pay"
   ```

2. **Verify URL building:**
   ```typescript
   // Check buildDenoUrl and buildPagesUrl
   // Ensure correct hyphenation and domain format
   ```

3. **Test routing logic:**
   ```bash
   # Force cache refresh to test routing
   curl -H "X-Cache-Control: refresh" https://domain.ubq.fi -v
   ```

### Plugin Routing Issues

**Symptoms:**
- Plugin domain returns 404
- Production alias not working
- Manifest validation failing
- Wrong deployment being accessed

**Common Plugin Issues:**

#### Plugin Not Found (404)
```bash
# Test: curl https://os-my-plugin.ubq.fi/manifest.json
# Returns: 404 Service not found
```

**Causes:**
1. Plugin not deployed to Deno Deploy with correct name
2. Production alias resolving to wrong deployment name
3. Manifest endpoint missing or invalid

**Solutions:**
1. **Verify deployment name:**
   ```bash
   # For os-my-plugin.ubq.fi, check if my-plugin-main.deno.dev exists
   curl -I https://my-plugin-main.deno.dev/manifest.json
   ```

2. **Test plugin name resolution:**
   ```bash
   # Debug plugin name parsing
   # os-command-config.ubq.fi should resolve to command-config-main
   # os-command-config-dev.ubq.fi should resolve to command-config-dev
   ```

3. **Check manifest endpoint:**
   ```bash
   # Test direct Deno Deploy access
   curl https://my-plugin-main.deno.dev/manifest.json

   # Verify JSON format
   curl -s https://my-plugin-main.deno.dev/manifest.json | jq '.'
   ```

#### Production Alias Not Working
```bash
# Expected: os-plugin.ubq.fi → plugin-main.deno.dev
# Actual: 404 or wrong target
```

**Solutions:**
1. **Check deployment suffix logic:**
   ```typescript
   // Verify getPluginName function handles production alias
   // Plugin without suffix should append -main
   ```

2. **Test all plugin URL variations:**
   ```bash
   # Production alias (should work)
   curl https://os-my-plugin.ubq.fi/manifest.json
   
   # Explicit main (should work)
   curl https://os-my-plugin-main.ubq.fi/manifest.json
   
   # Development full name (should work)
   curl https://os-my-plugin-development.ubq.fi/manifest.json
   
   # Development alias (should work)
   curl https://os-my-plugin-dev.ubq.fi/manifest.json
   
   # All should return same result or appropriate deployment
   ```

3. **Verify dev alias functionality:**
   ```bash
   # Both dev URLs should resolve to same target
   curl https://os-plugin-dev.ubq.fi/manifest.json
   curl https://os-plugin-development.ubq.fi/manifest.json
   # Both should route to plugin-development.deno.dev
   ```

#### Manifest Validation Failing
```bash
# Plugin exists but router returns 404
# Deno Deploy responds but manifest invalid
```

**Debugging Steps:**
1. **Check manifest structure:**
   ```bash
   # Must include name and description fields
   curl -s https://plugin-main.deno.dev/manifest.json | jq '.name, .description'
   ```

2. **Verify JSON validity:**
   ```bash
   # Test if response is valid JSON
   curl -s https://plugin-main.deno.dev/manifest.json | python -m json.tool
   ```

3. **Check content-type:**
   ```bash
   # Ensure application/json content-type
   curl -I https://plugin-main.deno.dev/manifest.json | grep content-type
   ```

#### Wrong Plugin Deployment
```bash
# Accessing dev instead of main, or vice versa
```

**Solutions:**
1. **Verify URL mapping:**
   ```bash
   # Check deployment suffix resolution
   # os-plugin.ubq.fi → plugin-main.deno.dev (production)
   # os-plugin-dev.ubq.fi → plugin-dev.deno.dev (development)
   ```

2. **Clear plugin cache:**
   ```bash
   # Clear specific plugin cache
   curl -H "X-Cache-Control: clear" https://os-plugin.ubq.fi
   curl -H "X-Cache-Control: refresh" https://os-plugin.ubq.fi
   ```

## Error Codes Reference

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| `200` | Success | Normal operation |
| `404` | Service not found | No services available for domain |
| `500` | Internal error | Worker code error, KV issues |
| `502` | Bad gateway | Target service error |
| `504` | Gateway timeout | Service discovery timeout |

### Worker Error Messages

| Message | Cause | Solution |
|---------|-------|----------|
| "Service not found" | No available services | Check service deployments |
| "Cache cleared" | Cache operation success | Normal operation |
| "Cleared N cache entries" | Bulk cache clear success | Normal operation |
| "Invalid domain format" | Domain parsing error | Check domain structure |

## Debugging Tools

### Development Debugging

1. **Add logging:**
   ```typescript
   console.log('Discovery result:', serviceType)
   console.log('Target URL:', targetUrl)
   ```

2. **Type checking:**
   ```bash
   bun run type-check
   ```

3. **Local testing:**
   ```bash
   bun run dev
   curl http://localhost:8787 -H "Host: test.ubq.fi" -v
   ```

### Production Debugging

1. **Cache inspection:**
   - Check Cloudflare KV dashboard
   - Look for cache key patterns: `route:*`

2. **Worker logs:**
   - View in Cloudflare Workers dashboard
   - Filter by time period and error level

3. **Service testing:**
   ```bash
   # Test cache control
   curl -H "X-Cache-Control: refresh" https://domain.ubq.fi -v

   # Test direct service access
   curl https://domain-ubq-fi.deno.dev -v
   curl https://domain-ubq-fi.pages.dev -v
   ```

### Monitoring Commands

```bash
# Check all cache entries
curl -H "X-Cache-Control: clear-all" https://ubq.fi
# Note the count returned

# Test service discovery
curl -H "X-Cache-Control: refresh" https://pay.ubq.fi

# Verify routing
curl https://pay.ubq.fi -v
```

## Recovery Procedures

### Complete System Reset

1. **Clear all cache:**
   ```bash
   curl -H "X-Cache-Control: clear-all" https://ubq.fi
   ```

2. **Redeploy worker:**
   ```bash
   bun run deploy
   ```

3. **Test critical services:**
   ```bash
   curl -H "X-Cache-Control: refresh" https://pay.ubq.fi
   curl https://pay.ubq.fi
   ```

### Service Recovery

1. **Individual service reset:**
   ```bash
   curl -H "X-Cache-Control: clear" https://problematic-service.ubq.fi
   curl -H "X-Cache-Control: refresh" https://problematic-service.ubq.fi
   ```

2. **Verify service health:**
   ```bash
   curl -I https://problematic-service-ubq-fi.deno.dev
   curl -I https://problematic-service-ubq-fi.pages.dev
   ```

### Emergency Procedures

1. **Disable routing (emergency):**
   - Temporarily point DNS directly to working service
   - Bypass worker routing entirely

2. **Rollback deployment:**
   ```bash
   # Deploy previous version
   git checkout previous-commit
   bun run deploy
   ```

3. **Contact support:**
   - Cloudflare Workers support for platform issues
   - Check Cloudflare status page for outages

## Getting Help

### Self-Diagnosis Checklist

- [ ] Check service URLs manually
- [ ] Verify KV namespace configuration
- [ ] Test cache control operations
- [ ] Review worker logs
- [ ] Confirm TypeScript compilation
- [ ] Validate deployment settings

### Support Resources

1. **Cloudflare Documentation:**
   - Workers: https://developers.cloudflare.com/workers/
   - KV: https://developers.cloudflare.com/kv/
   - Wrangler: https://developers.cloudflare.com/workers/wrangler/

2. **Community Support:**
   - Cloudflare Discord
   - Stack Overflow (cloudflare-workers tag)
   - GitHub Issues

3. **Internal Documentation:**
   - [Architecture Documentation](architecture.md)
   - [API Reference](api-reference.md)
   - [Deployment Guide](deployment.md)

Remember to include relevant error messages, configuration details, and steps already attempted when seeking help.
