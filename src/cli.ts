import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";

import { runConvert, type ConvertOptions } from "./commands/convert.js";
import { runScan } from "./commands/scan.js";
import { runVerify, type VerifyOptions } from "./commands/verify.js";
import type { GitHubService, GitService } from "./types/index.js";
import { ForkNeoError } from "./utils/errors.js";
import { consoleWriter, type OutputWriter } from "./utils/logger.js";
import { VERSION } from "./version.js";

export interface CliDependencies {
  github: GitHubService;
  git: GitService;
  token: string;
  confirm: (message: string) => Promise<boolean>;
  write: OutputWriter;
}

type DependencyProvider = CliDependencies | (() => Promise<CliDependencies>);

async function resolveDependencies(provider: DependencyProvider): Promise<CliDependencies> {
  return typeof provider === "function" ? provider() : provider;
}

async function withStatus<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (!process.stderr.isTTY) {
    return work();
  }
  const spinner = ora(label).start();
  try {
    const result = await work();
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export function createProgram(provider: DependencyProvider): Command {
  const program = new Command()
    .name("forkneo")
    .description("Convert GitHub forks into independent repositories.")
    .version(VERSION)
    .showHelpAfterError();

  program
    .command("scan")
    .description("List fork repositories owned by the authenticated user")
    .action(async () => {
      const dependencies = await resolveDependencies(provider);
      await withStatus("Scanning GitHub forks", () =>
        runScan(dependencies.github, dependencies.write),
      );
    });

  program
    .command("convert")
    .description("Convert a fork into a new independent repository")
    .argument("<repository>", "source repository in owner/repo format")
    .option("--name <name>", "explicit target repository name")
    .option("--suffix <suffix>", "target suffix", "neo")
    .option("-y, --yes", "skip the confirmation prompt")
    .action(async (repository: string, options: ConvertOptions) => {
      const dependencies = await resolveDependencies(provider);
      const result = await withStatus("Migrating repository", () =>
        runConvert(repository, options, dependencies),
      );
      dependencies.write(chalk.green(`Converted ${result.source} to ${result.target}`));
      dependencies.write(`Report: ${result.reportPath}`);
    });

  program
    .command("verify")
    .description("Verify that a repository is independent and complete")
    .argument("<repository>", "target repository in owner/repo format")
    .option("--source <repository>", "source repository to compare")
    .action(async (repository: string, options: VerifyOptions) => {
      const dependencies = await resolveDependencies(provider);
      const result = await withStatus("Verifying repository", () =>
        runVerify(repository, options, dependencies),
      );
      dependencies.write(
        chalk.green(
          `Verified ${result.target}: default branch ${result.defaultBranch}, ${result.refCount} refs`,
        ),
      );
    });

  return program;
}

export async function defaultConfirmation(message: string): Promise<boolean> {
  const answer = await inquirer.prompt<{ confirmed: boolean }>([
    { type: "confirm", name: "confirmed", message, default: false },
  ]);
  return answer.confirmed;
}

export function formatCliError(error: unknown): string {
  if (error instanceof ForkNeoError) {
    return error.hint ? `${error.message}\nHint: ${error.hint}` : error.message;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Unexpected error: ${message}`;
}

export { consoleWriter };
