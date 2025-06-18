# Plugin Routing Guide

## Overview

The UBQ.FI Router now supports dedicated plugin routing using the `os-*.ubq.fi` domain pattern. This guide explains the new naming convention and how to configure your deployments.

## Domain Pattern

### Standard Format
```
os-{plugin-name}-{deployment}.ubq.fi
```

### Examples
- **Production**: `os-command-config.ubq.fi` (aliases to `-main`)
- **Explicit Main**: `os-command-config-main.ubq.fi`
- **Development**: `os-command-config-dev.ubq.fi`
- **Feature Branch**: `os-command-config-feature-auth.ubq.fi`
- **Bug Fix**: `os-command-config-fix-validation.ubq.fi`

## Deployment Suffixes

### Standard Environments
- `main` - Production deployment (default when no suffix provided)
- `dev` / `development` - Development environment
- `staging` / `stage` - Staging environment
- `test` / `testing` - Testing environment
- `preview` - Preview deployments
- `beta` / `alpha` - Pre-release versions

### Branch-Based Deployments
- `feature-{name}` - Feature branch deployments
- `fix-{name}` - Bug fix deployments
- `hotfix-{name}` - Hotfix deployments

## Production Alias

**Special Case**: The production deployment can be accessed via clean URLs without the `-main` suffix:

✅ **Recommended Production URLs**:
```
https://os-command-config.ubq.fi        → command-config-main.deno.dev
https://os-pricing-calculator.ubq.fi    → pricing-calculator-main.deno.dev
https://os-issue-tracker.ubq.fi         → issue-tracker-main.deno.dev
```

✅ **Explicit Main URLs** (also supported):
```
https://os-command-config-main.ubq.fi   → command-config-main.deno.dev
```

## URL Mapping

The router transforms plugin domains to Deno Deploy URLs:

| Plugin Domain | Deno Deploy URL |
|---------------|-----------------|
| `os-command-config.ubq.fi` | `https://command-config-main.deno.dev` |
| `os-command-config-dev.ubq.fi` | `https://command-config-dev.deno.dev` |
| `os-pricing-calculator-feature-ui.ubq.fi` | `https://pricing-calculator-feature-ui.deno.dev` |

## Requirements

### 1. Manifest.json Endpoint
Your plugin **must** provide a valid `/manifest.json` endpoint:

```json
{
  "name": "command-config",
  "description": "Plugin description",
  "ubiquity:listeners": ["issue_comment.created"],
  "commands": { ... },
  "configuration": { ... }
}
```

### 2. HTTPS Only
All plugin domains use HTTPS and are covered by the `*.ubq.fi` SSL certificate.

### 3. Deno Deploy Hosting
Plugins must be deployed to Deno Deploy with the corresponding deployment name.

## Migration Checklist

- [ ] Update deployment scripts to use new `os-{plugin-name}-{environment}` pattern
- [ ] Configure production deployment as `{plugin-name}-main` on Deno Deploy
- [ ] Test manifest endpoint accessibility via new domain
- [ ] Update documentation and README files with new URLs
- [ ] Notify users of new production URL format

## Testing

Verify your plugin routing works:

```bash
# Test manifest endpoint
curl https://os-your-plugin.ubq.fi/manifest.json

# Test specific deployment
curl https://os-your-plugin-dev.ubq.fi/manifest.json

# Verify JSON response
curl -s https://os-your-plugin.ubq.fi/manifest.json | jq '.name'
```

## Troubleshooting

### Common Issues

1. **404 Not Found**: Plugin not deployed to Deno Deploy with correct name
2. **SSL Certificate Error**: DNS propagation delay (wait 5-10 minutes)
3. **Invalid JSON**: Manifest endpoint not returning proper JSON format

### Debug Commands

```bash
# Check DNS resolution
dig os-your-plugin.ubq.fi

# Test Deno Deploy directly
curl https://your-plugin-main.deno.dev/manifest.json

# Verify router transformation
curl -v https://os-your-plugin.ubq.fi/manifest.json
```

## Support

For issues with plugin routing, please contact the infrastructure team or file an issue in the router repository.
