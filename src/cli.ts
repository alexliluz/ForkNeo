import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";

import { runConvert, type ConvertOptions } from "./commands/convert.js";
import { runScan } from "./commands/scan.js";
import { runVerify, type VerifyOptions } from "./commands/verify.js";
import type {
  GitHubService,
  GitService,
  RepositoryInfo,
} from "./types/index.js";
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

interface JsonOutputOptions {
  json?: boolean;
}

type ConvertCliOptions = ConvertOptions & JsonOutputOptions;
type VerifyCliOptions = VerifyOptions & JsonOutputOptions;

async function resolveDependencies(provider: DependencyProvider): Promise<CliDependencies> {
  return typeof provider === "function" ? provider() : provider;
}

function writeJson(write: OutputWriter, value: unknown): void {
  write(JSON.stringify(value, null, 2));
}

function writeScanResult(
  repositories: RepositoryInfo[],
  write: OutputWriter,
): void {
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
    .option("--json", "write machine-readable JSON")
    .action(async (options: JsonOutputOptions) => {
      const dependencies = await resolveDependencies(provider);
      const result = await withStatus("Scanning GitHub forks", () =>
        runScan(dependencies.github),
      );
      if (options.json) {
        writeJson(dependencies.write, result);
        return;
      }
      writeScanResult(result.repositories, dependencies.write);
    });

  program
    .command("convert")
    .description("Convert a fork into a new independent repository")
    .argument("<repository>", "source repository in owner/repo format")
    .option("--name <name>", "explicit target repository name")
    .option("--suffix <suffix>", "target suffix", "neo")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--dry-run", "validate conversion without remote changes")
    .option("--json", "write machine-readable JSON")
    .action(async (repository: string, options: ConvertCliOptions) => {
      const dependencies = await resolveDependencies(provider);
      const result = await withStatus(
        options.dryRun ? "Checking conversion" : "Migrating repository",
        () => runConvert(repository, options, dependencies),
      );
      if (options.json) {
        writeJson(dependencies.write, result);
        return;
      }
      if (result.mode === "dry-run") {
        dependencies.write(
          chalk.green(`Dry run passed: ${result.source} -> ${result.target}`),
        );
        dependencies.write(`Default branch: ${result.defaultBranch}`);
        dependencies.write(`Refs: ${result.refCount}`);
        dependencies.write(
          `Git LFS: ${result.lfsDetected ? "detected" : "not detected"}`,
        );
        dependencies.write("Remote changes: none");
        return;
      }
      dependencies.write(chalk.green(`Converted ${result.source} to ${result.target}`));
      dependencies.write(`Report: ${result.reportPath}`);
    });

  program
    .command("verify")
    .description("Verify that a repository is independent and complete")
    .argument("<repository>", "target repository in owner/repo format")
    .option("--source <repository>", "source repository to compare")
    .option("--json", "write machine-readable JSON")
    .action(async (repository: string, options: VerifyCliOptions) => {
      const dependencies = await resolveDependencies(provider);
      const result = await withStatus("Verifying repository", () =>
        runVerify(repository, options, dependencies),
      );
      if (options.json) {
        writeJson(dependencies.write, result);
        return;
      }
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
