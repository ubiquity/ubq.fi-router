# Analytics Scripts

This directory contains analytics tools for monitoring KV write usage and analyzing historical data.

## 📊 Available Tools

### 1. Current KV Analytics (`kv-analytics.ts`)
- **Purpose**: Real-time KV analytics from production data
- **Data Source**: Cloudflare KV namespace via wrangler CLI
- **Usage**: `bun scripts/kv-analytics.ts` or `bun run analytics:kv`
- **Features**:
  - Current daily write count
  - Projected usage trends
  - Alert levels and recommendations
  - Operation breakdown

### 2. Historical Log Analysis (`analyze-kv-logs.ts`)
- **Purpose**: Analyze Cloudflare logs to estimate historical KV usage
- **Data Source**: Cloudflare Worker logs via wrangler tail
- **Usage**: `bun scripts/analyze-kv-logs.ts` or `bun run analytics:logs`
- **Use Case**: When analytics tracking hasn't been deployed yet but you need to know today's actual usage

## 🚀 Quick Start

```bash
# Check current KV analytics (from deployed analytics system)
bun run analytics:kv

# Analyze historical usage from logs (when analytics data is missing)
bun run analytics:logs

# Show help for all analytics tools
bun run analytics:help
```

## 📋 Use Cases

### Scenario 1: Analytics System is Deployed
If you have the analytics tracking system deployed, use the KV analytics tool:
```bash
bun scripts/kv-analytics.ts
```

### Scenario 2: No Analytics Data (Historical Analysis)
If analytics tracking is not yet deployed, analyze historical logs to estimate usage:
```bash
bun scripts/analyze-kv-logs.ts
```

### Scenario 3: Complete Picture
For a comprehensive view combining both data sources:
```bash
bun scripts/kv-analytics.ts --logs
```

## 🔍 What Each Tool Shows

### KV Analytics Output
```
📊 Enhanced KV Analytics Report
================================

Daily Usage: 45/1000 writes (4.5%)
Projected Total: 67 writes (6.7%)
Time to Reset: 14h 23m 15s (0:00 UTC / 9am KST)
Alert Level: ✅ Safe

Breakdown:
- Service discovery: 23 writes (51.1%)
- Sitemap generation: 12 writes (26.7%)
- Plugin map updates: 10 writes (22.2%)
```

### Historical Log Analysis Output
```
📊 Historical KV Usage Analysis
===============================

Today's Estimated Usage (from logs):
- Current writes: 23/1000 (2.3%)
- Hourly rate: 3 writes/hour
- Projected total: 72/1000 writes (7.2%)

Log Analysis Period: 2025-06-27 00:00 UTC to now
Requests analyzed: 156
Confidence: medium

Estimated Operation Breakdown:
- Sitemap XML generation: 8 writes (34.8%)
- Service discovery: 7 writes (30.4%)
- Plugin map generation: 5 writes (21.7%)
- Cache refresh requests: 3 writes (13.0%)
```

## ⚠️ Important Notes

1. **Historical analysis is estimative** - Log analysis provides estimates based on request patterns, not exact KV write counts
2. **Requires wrangler authentication** - Both tools need `npx wrangler login` to access Cloudflare data
3. **Time zone**: All times shown in UTC with KST equivalent (UTC+9)
4. **Daily reset**: KV write limits reset at 0:00 UTC (9am KST)

## 🛠️ Prerequisites

```bash
# Authenticate with Cloudflare
npx wrangler login

# Verify authentication
npx wrangler whoami
```

## 🔧 Troubleshooting

### Common Issues

1. **"Wrangler authentication required"**
   ```bash
   npx wrangler login
   ```

2. **"No analytics data found"**
   - Analytics system may not be deployed yet
   - Use historical log analysis: `bun scripts/analyze-kv-logs.ts`

3. **"Could not fetch logs"**
   - Check wrangler authentication
   - Ensure worker is deployed and receiving traffic

4. **TypeScript errors**
   ```bash
   bun run type-check
   bun install
   ```

### Debug Information

Both tools provide debug information including:
- KV namespace ID and binding name
- Current timestamp (UTC)
- Data source confirmation
- Confidence levels for estimates

## 📊 Understanding Alert Levels

- **✅ Safe** (0-75%): Normal usage levels
- **⚠️ Warning** (75-90%): Monitor usage closely
- **🔥 Critical** (90-100%): Reduce KV operations immediately
- **⛔ Exceeded** (>100%): KV writes are blocked until reset

## 🎯 Next Steps

1. Deploy analytics tracking system for real-time data
2. Set up monitoring alerts for critical usage levels
3. Optimize high-frequency KV operations if needed
4. Consider caching strategies to reduce writes