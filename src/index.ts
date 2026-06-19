import { pathToFileURL } from "node:url";

import "dotenv/config";

import { createProgram, defaultConfirmation, formatCliError } from "./cli.js";
import { createGitHubClient } from "./github/client.js";
import { GitHubRepositoryService } from "./github/repos.js";
import { ShellGitService } from "./git/mirror.js";
import { consoleWriter } from "./utils/logger.js";

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

const isDirectExecution =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
