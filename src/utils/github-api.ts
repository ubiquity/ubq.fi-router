/**
 * GitHub API Client for Version Detection
 * Automatically retrieves the latest commit hash from GitHub repositories
 */


export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  ref?: string; // optional branch or commit
}

export interface GitHubCommitInfo {
  sha: string;
  date: string;
  message: string;
  author: string;
}

export interface GitHubApiConfig {
  // Cache TTL in seconds (default: 1 hour)
  cacheTtl?: number;
  // Request timeout in ms (default: 5000)
  timeout?: number;
}

const DEFAULT_CACHE_TTL = 3600; // 1 hour
const DEFAULT_TIMEOUT = 5000;

/**
 * Fetch the latest commit hash from a GitHub repository
 */
export async function getLatestCommit(
  repoInfo: GitHubRepoInfo,
  config: GitHubApiConfig = {}
): Promise<GitHubCommitInfo | null> {
  const cacheTtl = config.cacheTtl ?? DEFAULT_CACHE_TTL;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  const ref = repoInfo.ref;
  const cacheKey = `${repoInfo.owner}/${repoInfo.repo}${ref ? `/${ref}` : ''}`;
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const url =
    `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits?per_page=1` +
    (ref ? `&sha=${encodeURIComponent(ref)}` : '');
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ubq-fi-router/1.0',
    'Authorization': `Bearer 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`,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Handle rate limiting gracefully
      if (response.status === 403) {
        const resetAfter = response.headers.get('X-RateLimit-Reset');
        if (resetAfter) {
          console.warn(`GitHub rate limited. Reset at: ${new Date(Number(resetAfter) * 1000).toISOString()}`);
        }
        // Return cached value or null on rate limit
        return getFromCache(cacheKey) || null;
      }
      
      console.error(`GitHub API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as Array<{
      sha: string;
      commit: {
        author: {
          name: string;
          date: string;
        };
        message: string;
      };
    }>;

    if (!data || data.length === 0) {
      return null;
    }

    const commitInfo: GitHubCommitInfo = {
      sha: data[0].sha,
      date: data[0].commit.author.date,
      message: data[0].commit.message.split('\n')[0], // First line only
      author: data[0].commit.author.name,
    };

    // Cache the result
    setCache(cacheKey, commitInfo, cacheTtl);

    return commitInfo;
  } catch (error) {
    console.error(`Failed to fetch commit from GitHub: ${error}`);
    // Return cached value on error
    return getFromCache(cacheKey) || null;
  }
}

/**
 * Parse a GitHub URL into owner and repo
 */
export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  // Handle various GitHub URL formats including /tree/<branch> and /commit/<sha>
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/(?:tree|commit)\/([^/]+))?\/?$/,
    /^git@github\.com:([^/]+)\/([^/]+)(?:\.git)?$/,
    /^([^/]+)\/([^/]+)$/, // Short form: owner/repo
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const repo = match[2].replace(/\.git$/, '');
      return { owner: match[1], repo, ref: match[3] };
    }
  }

  return null;
}

/**
 * Get the short commit hash (first 7 characters)
 */
export function getShortHash(sha: string): string {
  return sha.substring(0, 7);
}

// Simple in-memory cache implementation
interface CacheEntry {
  value: GitHubCommitInfo;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getFromCache(key: string): GitHubCommitInfo | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  
  return entry.value;
}

function setCache(key: string, value: GitHubCommitInfo, ttlSeconds: number): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Clear the version cache (useful for testing)
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; keys: string[] } {
  const now = Date.now();
  const validKeys: string[] = [];
  
  for (const [key, entry] of cache.entries()) {
    if (now < entry.expiresAt) {
      validKeys.push(key);
    }
  }
  
  return {
    size: validKeys.length,
    keys: validKeys,
  };
}
