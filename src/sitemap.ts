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
async function fetchPluginRepos(token?: string): Promise<string[]> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "ubq-fi-sitemap-generator",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const allRepos: string[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${GITHUB_API}/orgs/ubiquity-os-marketplace/repos?per_page=100&sort=updated&page=${page}`, { headers });

    if (!res.ok) {
      console.error(`Failed to fetch plugin repos page ${page}: ${res.status}`);
      break;
    }

    const repos: Array<{ name: string }> = await res.json();
    if (repos.length === 0) break;
    allRepos.push(...repos.map((r) => r.name));
    if (repos.length < 100) break;
    page++;
  }

  return allRepos.filter((r) => !r.startsWith(".") && !["command-config", "command-wallet", "command-query", "daemon-pricing", "daemon-merging", "daemon-disqualifier", "daemon-task-matcher", "daemon-planner", "daemon-xp", "daemon-spec-rewriter"].includes(r));
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
export async function buildSitemap(token?: string): Promise<{ xml: string; json: JsonSitemap }> {
  const now = new Date().toISOString();
  const appEntries: SitemapEntry[] = APP_SUBDOMAINS.map((sub) => ({
    loc: sub ? `https://${sub}.ubq.fi` : UBQ_FI_BASE,
    changefreq: "daily" as const,
    priority: sub === "" || sub === "www" ? 1.0 : 0.8,
  }));

  let pluginEntries: SitemapEntry[] = [];

  try {
    const pluginNames = await fetchPluginRepos(token);
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
