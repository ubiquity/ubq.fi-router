# Dynamic app and plugin maps

The router publishes four apex endpoints:

| Endpoint | Inventory | Format |
| --- | --- | --- |
| `https://ubq.fi/sitemap.json` | Apps | JSON |
| `https://ubq.fi/sitemap.xml` | Apps | XML |
| `https://ubq.fi/plugin-map.json` | Plugins | JSON |
| `https://ubq.fi/plugin-map.xml` | Plugins | XML |

## Discovery and configuration

The app inventory uses the worker's app bindings and public hosts from
`VPS_ORIGIN_MAP`, plus the built-in health dashboard. Only `ubq.fi` and its valid
subdomains are taken from the routing map. Private origin addresses, the legacy
`auth.ubq.fi` redirect, and retired/unconfigured hosts are excluded. The health
page is checked against this router repository, since the router serves it.

Both inventories reuse `HEALTH_CHECKS` and its existing GitHub workflow checks,
timeouts, optional server-side token, and 60-second isolate cache. Concurrent
XML, JSON, and dashboard requests share the same snapshot. This compiles CI
results; it does not probe apps or infer deployment health from repository HEAD.

Add optional metadata to the existing check configuration:

```json
[
  { "name": "Main app", "repository": "ubiquity/ubq.fi" },
  { "name": "Another app", "repository": "ubiquity/another-app", "siteUrl": "https://another.ubq.fi/" },
  { "name": "Plugin", "repository": "ubiquity-os/example-plugin", "kind": "plugin", "siteUrl": "https://plugins.example/webhook" }
]
```

- `kind` is optional: `app` (the default) or `plugin`. Only explicitly marked
  plugins enter the plugin map; an organization name is not proof of a plugin.
- `siteUrl` is optional and must be an absolute HTTPS URL without credentials or
  a fragment. It adds an app URL or identifies a plugin deployment. Plugins
  without it link to their GitHub repository. App checks without it match routed
  apps by repository, case-insensitively.
- Only configure repositories and URLs that may be published publicly. The
  existing limit of 20 checks and `workflow`/`branch` defaults still apply.

## JSON schema and status

Each response contains `kind` (`apps` or `plugins`), `updatedAt` (snapshot time),
`status`, and a URL-sorted `entries` array. An entry contains:

- `name`, `url`, and `repository` when the repository is known;
- `status` and `checks`, the matching dashboard check results including workflow,
  branch, run status, update time, run link, and any safe error message.

Entries are deduplicated by public URL; multiple matching workflows are retained.
Status is `degraded` if any check fails, `unknown` for missing/unavailable checks,
`operational` when all checks pass, and otherwise `pending`. The same precedence
summarizes entries at the response level. An empty inventory is `unknown`, not
passing. Unmonitored apps have `status: "unknown"` and `checks: []`.

HTTP 200 means the inventory was generated, even if services are degraded or
unknown. Invalid configuration produces HTTP 503 with an `error` in JSON or an
XML `<error>` document, and does not contact GitHub. Upstream GitHub failures
remain unknown check results rather than silently removing entries.

## XML and HTTP behavior

XML uses the sitemap `urlset`/`url`/`loc` vocabulary with names, repository,
status, and check fields in the `https://ubq.fi/ns/infrastructure` namespace.
Text is XML-escaped. CI timestamps are not content modification dates, so no
`lastmod` values are fabricated. Empty plugin inventories yield an empty urlset.

These maps describe infrastructure across multiple hosts. Search engines may
require separate per-host crawler sitemaps; app-owned `/sitemap.xml` paths on
other subdomains continue to proxy to their apps unchanged.

All endpoints support `GET`, bodyless `HEAD`, and CORS `OPTIONS` with public
read access. Other methods return 405. Responses are `no-store` at the HTTP
layer; only the shared server-side workflow snapshot is cached. Tokens and VPS
origin addresses are never included in either format.
