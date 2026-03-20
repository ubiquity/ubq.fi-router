/**
 * Sitemap generator for UBQ.FI
 * Produces XML sitemap and JSON index of all known apps and plugins.
 */

const APP_SUBDOMAINS = [
  "",
  "www",
  "pay",
  "work",
  "dashboard",
  "docs",
] as const;

const GITHUB_API = "https://api.github.com";
const UBQ_FI_BASE = "https://ubq.fi";

interface SitemapEntry {
  loc: string
  changefreq?: "daily" | "weekly" | "monthly"
  priority: number
  lastmod?: string
}

interface JsonSitemap {
  version: string
  generated: string
  generator: string
  base_url: string
  apps: SitemapEntry[]
  plugins: SitemapEntry[]
  total: number
}

/**
 * Get all plugin repositories from the ubiquity-os-marketplace GitHub org
 */
async function fetchPluginRepos(): Promise<string[]> {
  const res = await fetch(`${GITHUB_API}/orgs/ubiquity-os-marketplace/repos?per_page=100&sort=updated`, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "ubq-fi-sitemap-generator",
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch plugin repos: ${res.status}`);
    return [];
  }

  const repos: Array<{ name: string; pushed_at: string }> = await res.json();

  // Skip non-plugin repos (config repos, .github, etc.)
  return repos
    .filter((r) => !r.name.startsWith(".") && !["command-config", "command-wallet", "command-query", "daemon-pricing", "daemon-merging", "daemon-disqualifier", "daemon-task-matcher", "daemon-planner", "daemon-xp", "daemon-spec-rewriter", "daemon-xp"].includes(r.name))
    .map((r) => r.name);
}

/**
 * Generate XML sitemap string
 */
function toXmlSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ""}${e.changefreq ? `\n    <changefreq>${e.changefreq}</changefreq>` : ""}${e.priority !== undefined ? `\n    <priority>${e.priority.toFixed(1)}</priority>` : ""}
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the full sitemap (apps + plugins)
 */
export async function buildSitemap(): Promise<{ xml: string; json: JsonSitemap }> {
  const now = new Date().toISOString();
  const appEntries: SitemapEntry[] = APP_SUBDOMAINS.map((sub) => ({
    loc: sub ? `https://${sub}.ubq.fi` : UBQ_FI_BASE,
    changefreq: "daily" as const,
    priority: sub === "" || sub === "www" ? 1.0 : 0.8,
  }));

  let pluginEntries: SitemapEntry[] = [];

  try {
    const pluginNames = await fetchPluginRepos();
    pluginEntries = pluginNames.map((name, i) => ({
      loc: `https://os-${name}.ubq.fi`,
      changefreq: "weekly" as const,
      priority: 0.6,
    }));
  } catch (err) {
    console.error("Failed to build plugin sitemap entries:", err);
  }

  const allEntries = [...appEntries, ...pluginEntries];
  const jsonSitemap: JsonSitemap = {
    version: "1.0.0",
    generated: now,
    generator: "ubq-fi-router",
    base_url: UBQ_FI_BASE,
    apps: appEntries,
    plugins: pluginEntries,
    total: allEntries.length,
  };

  return {
    xml: toXmlSitemap(allEntries),
    json: jsonSitemap,
  };
}
