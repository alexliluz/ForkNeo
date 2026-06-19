import type { GitHubService } from "../types/index.js";
import type { OutputWriter } from "../utils/logger.js";
import { consoleWriter } from "../utils/logger.js";

export async function runScan(
  github: GitHubService,
  write: OutputWriter = consoleWriter,
): Promise<void> {
  const repositories = await github.listForks();
  if (repositories.length === 0) {
    write("No fork repositories found.");
    return;
  }

  write(
    [
      "Repository",
      "Upstream",
      "Visibility",
      "Archived",
      "Size KB",
      "Language",
      "Default",
      "Last push",
      "License",
    ].join("\t"),
  );

  for (const repository of repositories) {
    write(
      [
        repository.fullName,
        repository.parentFullName ?? "unknown",
        repository.visibility,
        repository.archived ? "yes" : "no",
        String(repository.size),
        repository.language ?? "unknown",
        repository.defaultBranch,
        repository.pushedAt ?? "unknown",
        repository.license ?? "unknown",
      ].join("\t"),
    );
  }
}
