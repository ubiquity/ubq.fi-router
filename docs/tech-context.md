# Tech Context

## Technologies Used
- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Package Manager**: Bun
- **Testing**: Bun test
- **Deployment**: Wrangler CLI (`wrangler.toml`)

## Development Setup
1. Install dependencies: `bun install`
2. Run tests: `bun test`
3. Start dev server: `bun run dev`
4. Deploy: `bun run deploy`

## Technical Constraints
- Must work within Cloudflare Workers runtime limitations
- Plugin discovery must complete within 100ms
- Sitemap generation must be efficient for large numbers of plugins
- Health dashboard must respond within 50ms

## Dependencies
```json
// From package.json
{
  "dependencies": {
    "@cloudflare/kv-asset-handler": "^0.2.0",
    "hono": "^3.12.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240416.0",
    "@types/node": "^20.12.7",
    "bun-types": "^1.0.21",
    "typescript": "^5.4.5",
    "wrangler": "^3.25.0"
  }
}
```

## Environment Variables
See `.env.example` for required configuration:
```bash
# .env.example
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
PLUGIN_DISCOVERY_URL=
SERVICE_DISCOVERY_URL=