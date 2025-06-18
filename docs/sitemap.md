# Dynamic Sitemap Generation

The UBQ.FI Router now includes dynamic sitemap generation capabilities that automatically discover all active services and plugins across the ubq.fi domain ecosystem.

## Features

- **Dynamic Discovery**: Automatically discovers all active services and plugins
- **Multiple Formats**: Provides both XML and JSON sitemap formats
- **Intelligent Caching**: Caches results for 6 hours to optimize performance
- **Priority Ranking**: Prioritizes entries based on service type and importance
- **GitHub Integration**: Includes GitHub repository metadata for each service/plugin
- **Plugin Manifests**: Fetches and includes plugin manifest data when available

## Endpoints

### XML Sitemap
```
GET https://ubq.fi/sitemap.xml
```
Standard XML sitemap format compatible with search engines.

### JSON Sitemap
```
GET https://ubq.fi/sitemap.json
```
Machine-readable JSON format for easy interoperability.

## JSON Structure

```json
{
  "version": "1.0",
  "generator": "UBQ.FI Router v1.0",
  "generated": "2024-06-19T00:00:00.000Z",
  "total": 25,
  "entries": [
    {
      "url": "https://ubq.fi",
      "priority": 1.0,
      "changeFreq": "daily",
      "lastModified": "2024-06-19T00:00:00.000Z",
      "serviceType": "service-pages",
      "subdomain": "",
      "githubRepo": "ubiquity/ubq.fi",
      "title": "UBQ.FI - Ubiquity Protocol",
      "description": "Main website for Ubiquity Protocol"
    }
  ]
}
```

## Cache Control

You can control sitemap caching using the `X-Cache-Control` header:

- `refresh` - Force refresh and regenerate sitemap
- `clear` - Clear individual cache entries
- `clear-all` - Clear all cache entries

Example:
```bash
curl -H "X-Cache-Control: refresh" https://ubq.fi/sitemap.xml
```

## Service Discovery Logic

The sitemap generation follows this discovery process:

1. **Standard Services**: Discovers all known services from the KV cache
2. **Plugin Services**: Fetches plugin list from GitHub API and tests each one
3. **Service Testing**: Tests each subdomain for active deployments
4. **Manifest Fetching**: Attempts to fetch plugin manifests from Deno Deploy
5. **Metadata Enrichment**: Adds GitHub repository links and descriptions
6. **Priority Calculation**: Assigns priorities based on service type and importance

## Priority System

- **Root Domain** (`ubq.fi`): Priority 1.0
- **Core Services**: Priority 0.9
- **Active Plugins**: Priority 0.8
- **Development Services**: Priority 0.7
- **Non-existent Services**: Excluded from sitemap

## Performance Considerations

- **Batch Processing**: Services are discovered in parallel batches to optimize performance
- **Timeout Handling**: Each service test has a 5-second timeout
- **Rate Limiting**: GitHub API calls are batched to respect rate limits
- **Caching**: Results are cached for 6 hours to minimize API calls
- **Worker Limits**: Cloudflare Worker CPU time limits are respected

## GitHub Token Configuration

For optimal performance, configure a GitHub token in your environment:

```
GITHUB_TOKEN=your_github_token_here
```

This enables:
- Higher GitHub API rate limits
- Faster plugin discovery
- More reliable sitemap generation

Without a token, the system will still work but may be slower due to rate limiting.

## Integration with Search Engines

The XML sitemap follows standard protocols and can be submitted to search engines:

1. Google Search Console
2. Bing Webmaster Tools
3. Other search engine submission tools

## Monitoring

Monitor sitemap generation through:
- Cloudflare Worker logs
- Cache hit/miss ratios
- API response times
- Error rates

## Error Handling

The system gracefully handles:
- Service timeouts
- GitHub API rate limits
- Network failures
- Invalid manifests
- Missing repositories

Failed services are logged but don't prevent sitemap generation.
