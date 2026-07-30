import { execa, type Options } from "execa";

import { ForkNeoError } from "../utils/errors.js";
import {
  createGitAuthentication,
  redactGitSecrets,
  type GitAuthentication,
} from "./auth.js";
import { inspectGitLfs } from "./lfs.js";

type CommandResult = { stdout: string; stderr: string };
type CommandRunner = (
  file: string,
  args: string[],
  options: Options,
) => Promise<CommandResult>;

const defaultRunner: CommandRunner = async (file, args, options) => {
  const result = await execa(file, args, options);
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
};

function authenticatedOptions(
  options: Options,
  authentication: GitAuthentication,
): Options {
  return {
    ...options,
    env: authentication.env,
    extendEnv: false,
  };
}

export class ShellGitService {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  private async execute(
    operation: string,
    args: string[],
    options: Options,
    secrets: readonly string[] = [],
  ): Promise<CommandResult> {
    try {
      return await this.run("git", args, options);
    } catch (error) {
      const detail = redactGitSecrets(
        error instanceof Error ? error.message : String(error),
        secrets,
      );
      const message = `Git ${operation} failed: ${detail}`;
      throw new ForkNeoError(
        "GIT_COMMAND_FAILED",
        message,
        "Run with a valid token and confirm Git and Git LFS are installed.",
        { cause: new Error(message) },
      );
    }
  }

  private async executeAuthenticated(
    operation: string,
    args: string[],
    options: Options,
    repositoryUrl: string,
    token: string,
  ): Promise<CommandResult> {
    const authentication = createGitAuthentication(repositoryUrl, token);
    return this.execute(
      operation,
      args,
      authenticatedOptions(options, authentication),
      authentication.secrets,
    );
  }

  async cloneMirror(
    sourceUrl: string,
    directory: string,
    token: string,
  ): Promise<void> {
    const authentication = createGitAuthentication(sourceUrl, token);
    await this.execute(
      "mirror clone",
      ["clone", "--mirror", authentication.url, directory],
      authenticatedOptions({ reject: true }, authentication),
      authentication.secrets,
    );
  }

  async pushMirror(
    directory: string,
    targetUrl: string,
    token: string,
  ): Promise<void> {
    const authentication = createGitAuthentication(targetUrl, token);
    await this.execute(
      "mirror push",
      ["push", "--mirror", authentication.url],
      authenticatedOptions(
        { cwd: directory, reject: true },
        authentication,
      ),
      authentication.secrets,
    );
  }

  async pruneUnsupportedRefs(directory: string): Promise<void> {
    const result = await this.execute(
      "pull-request ref inspection",
      ["for-each-ref", "--format=%(refname)", "refs/pull"],
      { cwd: directory, reject: true },
    );
    const refs = result.stdout.split(/\r?\n/).filter(Boolean);
    if (refs.length === 0) {
      return;
    }
    await this.execute(
      "pull-request ref removal",
      ["update-ref", "--stdin"],
      {
        cwd: directory,
        input: `${refs.map((ref) => `delete ${ref}`).join("\n")}\n`,
        reject: true,
      },
    );
  }

  async hasLfs(directory: string): Promise<boolean> {
    return inspectGitLfs(directory, this.run);
  }

  async fetchAllLfs(
    directory: string,
    sourceUrl: string,
    token: string,
  ): Promise<void> {
    await this.executeAuthenticated(
      "LFS fetch",
      ["lfs", "fetch", "--all", "origin"],
      { cwd: directory, reject: true },
      sourceUrl,
      token,
    );
  }

  async pushAllLfs(
    directory: string,
    targetUrl: string,
    token: string,
  ): Promise<void> {
    const authentication = createGitAuthentication(targetUrl, token);
    await this.execute(
      "LFS push",
      ["lfs", "push", "--all", authentication.url],
      authenticatedOptions(
        { cwd: directory, reject: true },
        authentication,
      ),
      authentication.secrets,
    );
  }
}
