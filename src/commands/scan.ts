import type { GitHubService, RepositoryInfo } from "../types/index.js";

export interface ScanResult {
  repositories: RepositoryInfo[];
}

export async function runScan(
  github: GitHubService,
): Promise<ScanResult> {
  const repositories = await github.listForks();
  return { repositories };
}
