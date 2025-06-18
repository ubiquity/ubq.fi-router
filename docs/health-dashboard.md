# UBQ.FI Health Dashboard

A real-time status monitoring dashboard for all UBQ.FI services and plugins, accessible at `health.ubq.fi`.

## Overview

The health dashboard provides:
- **Real-time monitoring** of all 14 services and 36 plugin variants
- **Visual status indicators** with health percentages
- **Detailed service information** including deployment types and error details
- **Automatic refresh** every 5 minutes
- **API endpoint** for programmatic access

## Architecture

### Components

1. **Health Dashboard Page** (`health.ubq.fi`)
   - Modern, responsive web interface
   - Real-time status display with auto-refresh
   - Dark theme optimized for monitoring

2. **Health API** (`/json`)
   - RESTful JSON API for health data
   - 10-minute caching with 5-minute browser cache
   - CORS-enabled for external access

3. **Health Validation Logic**
   - Reuses existing comprehensive validation framework
   - Tests both service discovery and domain accessibility
   - Validates plugin manifests and routing

### Data Sources

The health dashboard integrates with:
- **GitHub API**: Fetches service and plugin repository lists
- **Service Discovery**: Tests Deno Deploy and Cloudflare Pages deployments
- **Domain Health Checks**: Validates ubq.fi domain accessibility
- **Plugin Validation**: Checks manifest.json files and routing

## API Reference

### GET /json

Returns comprehensive health status for all services and plugins.

**Response Format:**
```json
{
  "lastUpdated": "2025-01-19T20:04:53.123Z",
  "services": [
    {
      "name": "pay",
      "domain": "pay.ubq.fi",
      "serviceType": "service-both",
      "healthy": true,
      "status": 200,
      "denoExists": true,
      "pagesExists": true,
      "lastChecked": "2025-01-19T20:04:53.123Z"
    }
  ],
  "plugins": [
    {
      "name": "daemon-pricing-main",
      "variant": "main",
      "domain": "os-daemon-pricing.ubq.fi",
      "healthy": false,
      "status": 404,
      "manifestValid": true,
      "lastChecked": "2025-01-19T20:04:53.123Z"
    }
  ],
  "summary": {
    "totalServices": 14,
    "healthyServices": 13,
    "totalPlugins": 36,
    "healthyPlugins": 9,
    "overallHealthPercentage": 44
  }
}
```

**Caching:**
- Server-side: 10 minutes (KV cache)
- Client-side: 5 minutes (HTTP cache)
- Error fallback: Uses stale cache data

## Usage

### Accessing the Dashboard

Visit `health.ubq.fi` to view the real-time dashboard.

### API Integration

```bash
# Get current health status
curl https://health.ubq.fi/json

# Force refresh (bypasses cache)
curl -H "X-Cache-Control: refresh" https://health.ubq.fi/json
```

### Integration with GitHub Actions

The health dashboard complements the existing CI/CD infrastructure:

- **CI Workflow** (`.github/workflows/ci.yml`): Tests on every push/PR
- **Infrastructure Health** (`.github/workflows/infrastructure-health.yml`): Scheduled monitoring every 6 hours
- **Health Dashboard**: Real-time status accessible to users and external systems

## Health Metrics

### Service Health Indicators

- **Healthy**: Domain responds with 2xx/3xx status and deployments exist
- **Unhealthy**: Domain returns 4xx/5xx or no deployments found

### Plugin Health Indicators  

- **Healthy**: Domain responds successfully AND manifest.json is valid
- **Unhealthy**: Domain fails OR manifest.json missing/invalid

### Service Types

- `service-both`: Available on both Deno Deploy and Cloudflare Pages
- `service-deno`: Available only on Deno Deploy  
- `service-pages`: Available only on Cloudflare Pages
- `service-none`: No deployments found

### Plugin Types

- `plugin-deno`: Deployed to Deno Deploy with valid manifest
- `plugin-pages`: Deployed to Cloudflare Pages with valid manifest
- `plugin-both`: Available on both platforms
- `plugin-none`: No deployments found

## Implementation Details

### Files Structure

```
src/health-dashboard/
├── api.ts           # Health API handler
└── index.html       # Dashboard HTML (embedded in worker)

src/worker.ts        # Updated to handle health routes
tests/health-api.test.ts  # API validation tests
```

### Key Features

1. **Error Resilience**: Falls back to cached data on API failures
2. **Performance**: Parallel health checks with timeouts
3. **Caching**: Multi-level caching strategy for performance
4. **Monitoring**: Integrates with existing infrastructure health checks
5. **Accessibility**: CORS-enabled API for external integrations

## Current Status

Based on the latest comprehensive validation:

- **Services**: 13/14 domains working (93% success rate)
- **Plugins**: 9/36 manifests valid, 0/36 domains working (routing issues)
- **Overall System Health**: 26% (infrastructure needs DNS/routing fixes)

### Known Issues

1. **Plugin Routing**: All plugin domains return 404 despite valid manifests
2. **DNS Configuration**: Development variant domains missing from DNS
3. **Infrastructure**: Some main variants exist in DNS but routing fails

The health dashboard provides visibility into these issues and tracks improvements over time.

## Future Enhancements

- **Historical Trends**: Store health data over time
- **Alerting**: Integration with external monitoring systems  
- **GitHub Actions Integration**: Display workflow run status
- **Performance Metrics**: Response time tracking
- **Incident Management**: Automatic issue creation for outages
