# Deployment

## Cloudflare Workers Deployment
1. Install Wrangler CLI: `bun add -g wrangler`
2. Configure environment variables in `.env`:
```bash
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
PLUGIN_DISCOVERY_URL=https://discovery.example.com
SERVICE_DISCOVERY_URL=https://services.example.com
```

## GitHub Token Setup for CI/CD
1. Create GitHub secret for Cloudflare API token:
```bash
gh secret set CLOUDFLARE_API_TOKEN --body "$CLOUDFLARE_API_TOKEN"
```

2. Add deployment workflow (`.github/workflows/deploy.yml`):
```yaml
name: Deploy to Cloudflare Workers
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: bun install
      - run: bun run build
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@3.0.0
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

## DNS Configuration
- Use scripts to manage DNS records:
```typescript
// scripts/update-dns-records.ts
import { updateDNSRecords } from '../src/utils';

await updateDNSRecords({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  apiToken: process.env.CLOUDFLARE_API_TOKEN!,
});
```

## Verification
- Verify deployment: `wrangler tail`
- Test DNS updates: `bun run scripts/verify-dns-fix.ts`
