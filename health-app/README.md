# UBQ.FI Health Monitor

A standalone Deno Deploy application for monitoring the health of all UBQ.FI services and plugins.

## Features

- **Real-time Health Monitoring**: Tracks status of all UBQ.FI services and plugins
- **Deno KV Storage**: Uses Deno's built-in KV store for persistent health data
- **Rate Limiting**: Built-in rate limiting to prevent excessive API calls
- **Fallback Mode**: Automatic fallback to localStorage when KV limits are hit
- **Client-side Checking**: Distributed health checking reduces server load
- **Legacy API Support**: Compatible with existing health dashboard endpoints

## Architecture

```
health-app/
├── api/           # API endpoint handlers
├── storage/       # Deno KV operations and types
├── utils/         # Health checking and router API utilities
├── dashboard/     # Static dashboard files
└── main.ts        # Deno Deploy entry point
```

## API Endpoints

- `GET /health/services` - List all services and plugins
- `GET /health/cache` - Get cached health data
- `POST /health/update` - Update health status
- `GET /health/proxy/status?domain=X` - Check service health
- `GET /health/proxy/manifest?domain=X` - Check plugin manifest
- `GET /json` - Legacy API endpoint
- `GET /` - Health dashboard

## Development

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Run locally
deno task dev

# Or with manual command
deno run --allow-net --allow-env --allow-read --allow-write --watch main.ts
```

## Deployment

Deploy to Deno Deploy:

1. Connect your GitHub repository to Deno Deploy
2. Set the entry point to `health-app/main.ts`
3. Configure environment variables if needed
4. Deploy

## Environment Variables

No environment variables are required - the app fetches services list from the main ubq.fi router sitemap and plugin-map endpoints.

## KV Storage Structure

The app uses Deno KV with the following structure:

```
['health', 'cache'] -> CachedHealthData {
  services: { [key: string]: ServiceHealth }
  plugins: { [key: string]: PluginHealth }
  lastGlobalUpdate: string
}
```

## Rate Limiting

- Health checks are rate limited to once every 5 minutes per service/plugin
- Updates to KV storage include rate limiting to prevent abuse
- Automatic fallback to localStorage when KV limits are exceeded

## Performance Optimizations

- Client-side health checking reduces server load
- Batch processing of health checks (5 at a time)
- Caching with appropriate TTLs
- Rate limiting prevents excessive resource usage
- Fallback storage prevents service disruption

## Monitoring

The dashboard provides real-time monitoring with:

- Overall system health percentage
- Service and plugin status counts
- Last update timestamps
- Individual service/plugin details
- Error reporting
- Automatic refresh every 5 minutes
