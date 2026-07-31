import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import { createProgram, defaultConfirmation, formatCliError } from "./cli.js";
import { createGitHubClient } from "./github/client.js";
import { GitHubRepositoryService } from "./github/repos.js";
import { ShellGitService } from "./git/mirror.js";
import { consoleWriter } from "./utils/logger.js";

export function isDirectExecution(
  argvEntry: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argvEntry) {
    return false;
  }

  try {
    return (
      realpathSync.native(argvEntry) ===
      realpathSync.native(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}

export async function main(argv = process.argv): Promise<void> {
  const program = createProgram(async () => {
    const { token, octokit } = await createGitHubClient();
    return {
      github: new GitHubRepositoryService(octokit),
      git: new ShellGitService(),
      token,
      confirm: defaultConfirmation,
      write: consoleWriter,
    };
  });
  await program.parseAsync(argv);
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
