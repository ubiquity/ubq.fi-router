export function validateGithubToken(githubToken: string): string {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN environment variable is required but not found');
  }
  return githubToken;
}