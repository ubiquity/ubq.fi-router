# GitHub Actions Integration Guide

## Overview

This guide explains how to modify your existing Deno Deploy GitHub Actions workflow to work with the new `os-*.ubq.fi` plugin routing system.

## Current vs New Deployment Pattern

### Before (Old Pattern)
```yaml
# Old deployment name
deployment-name: my-plugin-${GITHUB_REF_NAME}
# Results in: my-plugin-main, my-plugin-feature-auth, etc.
```

### After (New Pattern)
```yaml
# New deployment name with router-compatible format
deployment-name: my-plugin-${DEPLOYMENT_SUFFIX}
# Results in: my-plugin-main, my-plugin-feature-auth, etc.
# Router URLs: os-my-plugin.ubq.fi, os-my-plugin-feature-auth.ubq.fi
```

## Updated Workflow Configuration

### Step 1: Update Environment Variables

Add these environment variables to your workflow:

```yaml
env:
  PLUGIN_NAME: "your-plugin-name"  # Replace with your plugin name
  DENO_DEPLOY_TOKEN: ${{ secrets.DENO_DEPLOY_TOKEN }}
```

### Step 2: Dynamic Deployment Suffix Logic

Replace your current branch-based naming with this logic:

```yaml
- name: Determine Deployment Suffix
  id: deployment
  run: |
    BRANCH_NAME="${GITHUB_REF_NAME}"

    # Production branch (main/master) maps to 'main'
    if [[ "$BRANCH_NAME" == "main" || "$BRANCH_NAME" == "master" ]]; then
      DEPLOYMENT_SUFFIX="main"

    # Development branch
    elif [[ "$BRANCH_NAME" == "dev" || "$BRANCH_NAME" == "development" ]]; then
      DEPLOYMENT_SUFFIX="dev"

    # Staging branches
    elif [[ "$BRANCH_NAME" == "staging" || "$BRANCH_NAME" == "stage" ]]; then
      DEPLOYMENT_SUFFIX="staging"

    # Feature branches (feature/*, feat/*)
    elif [[ "$BRANCH_NAME" =~ ^(feature|feat)/ ]]; then
      FEATURE_NAME=$(echo "$BRANCH_NAME" | sed 's|^[^/]*/||' | tr '/' '-')
      DEPLOYMENT_SUFFIX="feature-${FEATURE_NAME}"

    # Bug fix branches (fix/*, bugfix/*, hotfix/*)
    elif [[ "$BRANCH_NAME" =~ ^(fix|bugfix|hotfix)/ ]]; then
      FIX_NAME=$(echo "$BRANCH_NAME" | sed 's|^[^/]*/||' | tr '/' '-')
      DEPLOYMENT_SUFFIX="fix-${FIX_NAME}"

    # Pull request branches (use PR number)
    elif [[ "$BRANCH_NAME" =~ ^pr- ]]; then
      PR_NUMBER=$(echo "$BRANCH_NAME" | sed 's/^pr-//')
      DEPLOYMENT_SUFFIX="pr-${PR_NUMBER}"

    # Other branches (sanitize name)
    else
      SANITIZED_NAME=$(echo "$BRANCH_NAME" | tr '/' '-' | tr '_' '-' | tr '[:upper:]' '[:lower:]')
      DEPLOYMENT_SUFFIX="${SANITIZED_NAME}"
    fi

    # Set outputs
    echo "suffix=${DEPLOYMENT_SUFFIX}" >> $GITHUB_OUTPUT
    echo "name=${PLUGIN_NAME}-${DEPLOYMENT_SUFFIX}" >> $GITHUB_OUTPUT
    echo "router-url=https://os-${PLUGIN_NAME}" >> $GITHUB_OUTPUT

    # Add deployment suffix to router URL if not main
    if [[ "$DEPLOYMENT_SUFFIX" != "main" ]]; then
      echo "router-url=https://os-${PLUGIN_NAME}-${DEPLOYMENT_SUFFIX}.ubq.fi" >> $GITHUB_OUTPUT
    else
      echo "router-url=https://os-${PLUGIN_NAME}.ubq.fi" >> $GITHUB_OUTPUT
    fi
```

### Step 3: Deploy to Deno Deploy

Update your Deno Deploy step:

```yaml
- name: Deploy to Deno Deploy
  uses: denoland/deployctl@v1
  with:
    project: ${{ steps.deployment.outputs.name }}
    entrypoint: src/main.ts  # Adjust to your entry point
    root: .
    exclude: |
      .git
      .github
      node_modules
      README.md
      .env*
```

### Step 4: Output Router Information

Add a step to display the router URLs:

```yaml
- name: Display Router Information
  run: |
    echo "🚀 Deployment complete!"
    echo "📦 Deno Deploy: https://${{ steps.deployment.outputs.name }}.deno.dev"
    echo "🌐 Router URL: ${{ steps.deployment.outputs.router-url }}"
    echo "📋 Manifest: ${{ steps.deployment.outputs.router-url }}/manifest.json"
```

## Complete Example Workflow

```yaml
name: Deploy Plugin

on:
  push:
    branches: [ main, dev, staging ]
  pull_request:
    branches: [ main ]

env:
  PLUGIN_NAME: "command-config"  # 🚨 UPDATE THIS
  DENO_DEPLOY_TOKEN: ${{ secrets.DENO_DEPLOY_TOKEN }}

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup Deno
      uses: denoland/setup-deno@v1
      with:
        deno-version: v1.x

    - name: Determine Deployment Suffix
      id: deployment
      run: |
        BRANCH_NAME="${GITHUB_REF_NAME}"

        if [[ "$BRANCH_NAME" == "main" || "$BRANCH_NAME" == "master" ]]; then
          DEPLOYMENT_SUFFIX="main"
        elif [[ "$BRANCH_NAME" == "dev" || "$BRANCH_NAME" == "development" ]]; then
          DEPLOYMENT_SUFFIX="dev"
        elif [[ "$BRANCH_NAME" == "staging" || "$BRANCH_NAME" == "stage" ]]; then
          DEPLOYMENT_SUFFIX="staging"
        elif [[ "$BRANCH_NAME" =~ ^(feature|feat)/ ]]; then
          FEATURE_NAME=$(echo "$BRANCH_NAME" | sed 's|^[^/]*/||' | tr '/' '-')
          DEPLOYMENT_SUFFIX="feature-${FEATURE_NAME}"
        elif [[ "$BRANCH_NAME" =~ ^(fix|bugfix|hotfix)/ ]]; then
          FIX_NAME=$(echo "$BRANCH_NAME" | sed 's|^[^/]*/||' | tr '/' '-')
          DEPLOYMENT_SUFFIX="fix-${FIX_NAME}"
        else
          SANITIZED_NAME=$(echo "$BRANCH_NAME" | tr '/' '-' | tr '_' '-' | tr '[:upper:]' '[:lower:]')
          DEPLOYMENT_SUFFIX="${SANITIZED_NAME}"
        fi

        echo "suffix=${DEPLOYMENT_SUFFIX}" >> $GITHUB_OUTPUT
        echo "name=${PLUGIN_NAME}-${DEPLOYMENT_SUFFIX}" >> $GITHUB_OUTPUT

        if [[ "$DEPLOYMENT_SUFFIX" != "main" ]]; then
          echo "router-url=https://os-${PLUGIN_NAME}-${DEPLOYMENT_SUFFIX}.ubq.fi" >> $GITHUB_OUTPUT
        else
          echo "router-url=https://os-${PLUGIN_NAME}.ubq.fi" >> $GITHUB_OUTPUT
        fi

    - name: Run tests
      run: deno test --allow-all

    - name: Deploy to Deno Deploy
      uses: denoland/deployctl@v1
      with:
        project: ${{ steps.deployment.outputs.name }}
        entrypoint: src/main.ts
        root: .
        exclude: |
          .git
          .github
          node_modules
          README.md
          .env*

    - name: Test Manifest Endpoint
      run: |
        sleep 10  # Wait for deployment to be ready
        curl -f "${{ steps.deployment.outputs.router-url }}/manifest.json" || exit 1

    - name: Display Deployment Info
      run: |
        echo "🚀 Deployment complete!"
        echo "📦 Deno Deploy: https://${{ steps.deployment.outputs.name }}.deno.dev"
        echo "🌐 Router URL: ${{ steps.deployment.outputs.router-url }}"
        echo "📋 Manifest: ${{ steps.deployment.outputs.router-url }}/manifest.json"
```

## Branch Mapping Examples

| Branch Name | Deployment Name | Router URL |
|-------------|-----------------|------------|
| `main` | `my-plugin-main` | `https://os-my-plugin.ubq.fi` |
| `dev` | `my-plugin-dev` | `https://os-my-plugin-dev.ubq.fi` |
| `feature/auth-system` | `my-plugin-feature-auth-system` | `https://os-my-plugin-feature-auth-system.ubq.fi` |
| `fix/validation-bug` | `my-plugin-fix-validation-bug` | `https://os-my-plugin-fix-validation-bug.ubq.fi` |
| `staging` | `my-plugin-staging` | `https://os-my-plugin-staging.ubq.fi` |

## Migration Steps

1. **Update Plugin Name**: Change `PLUGIN_NAME` in your workflow
2. **Replace Branch Logic**: Use the new deployment suffix logic
3. **Update Deploy Step**: Ensure correct project naming
4. **Add Manifest Test**: Verify the router endpoint works
5. **Test Deployment**: Push to a feature branch and verify routing

## Troubleshooting

### Common Issues

1. **Invalid Deno Deploy Project Name**: Ensure it follows `{plugin-name}-{suffix}` format
2. **Router 404**: Check that Deno Deploy project matches expected name
3. **Manifest Test Fails**: Verify your `/manifest.json` endpoint exists and returns valid JSON

### Debug Commands

```bash
# Test Deno Deploy directly
curl https://my-plugin-main.deno.dev/manifest.json

# Test router endpoint
curl https://os-my-plugin.ubq.fi/manifest.json

# Check deployment name format
echo "Expected: my-plugin-main"
echo "Actual: ${{ steps.deployment.outputs.name }}"
```

## Notes

- Router automatically handles the production alias (`os-plugin.ubq.fi` → `plugin-main.deno.dev`)
- DNS propagation may take 5-10 minutes for new deployments
- All router URLs use HTTPS with automatic SSL certificates
- Manifest endpoint validation is required for plugin discovery
