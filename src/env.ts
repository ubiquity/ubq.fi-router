/**
 * Environment variable loader
 * Fails fast if required environment variables are missing
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

if (!GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is required but not found")
}

export { GITHUB_TOKEN }
