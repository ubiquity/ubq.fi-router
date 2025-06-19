# Product Context

## Why This Project Exists
- To solve the problem of fragmented plugin and service discovery in distributed systems
- To provide a unified routing solution for micro-frontends and microservices
- To automate sitemap generation for dynamic plugin-based content

## Problems It Solves
1. Manual discovery of plugins across different domains
2. Inconsistent routing patterns between services
3. Lack of automated sitemap updates for search engines
4. Limited visibility into system health across multiple services

## How It Should Work
1. Automatically discover plugins and services using `src/plugin-map-discovery.ts` and `src/service-discovery.ts`
2. Generate unified routing through `src/routing.ts`
3. Create optimized sitemaps with `src/sitemap-generator.ts`
4. Provide real-time health monitoring via `src/health-dashboard/api.ts`

## User Experience Goals
- Developers can add new plugins with zero-configuration
- SEO teams get automatically updated sitemaps
- Operations teams have a single dashboard for system health
- All stakeholders see consistent routing patterns