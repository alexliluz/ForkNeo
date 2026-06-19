import { execa, type Options } from "execa";

import { ForkNeoError } from "../utils/errors.js";

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

function authenticatedUrl(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.username = "x-access-token";
  parsed.password = token;
  return parsed.toString();
}

function redact(value: string, token: string): string {
  return value
    .replaceAll(token, "[REDACTED]")
    .replaceAll(encodeURIComponent(token), "[REDACTED]");
}

export class ShellGitService {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  private async execute(
    args: string[],
    options: Options,
    token: string,
  ): Promise<CommandResult> {
    try {
      return await this.run("git", args, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ForkNeoError(
        "GIT_COMMAND_FAILED",
        redact(message, token),
        "Run with a valid token and confirm Git and Git LFS are installed.",
        { cause: error },
      );
    }
  }

  async cloneMirror(sourceUrl: string, directory: string, token: string): Promise<void> {
    await this.execute(
      ["clone", "--mirror", authenticatedUrl(sourceUrl, token), directory],
      { reject: true },
      token,
    );
  }

  async pushMirror(directory: string, targetUrl: string, token: string): Promise<void> {
    await this.execute(
      ["push", "--mirror", authenticatedUrl(targetUrl, token)],
      { cwd: directory, reject: true },
      token,
    );
  }

  async pruneUnsupportedRefs(directory: string): Promise<void> {
    const result = await this.run(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/pull"],
      { cwd: directory, reject: true },
    );
    const refs = result.stdout.split(/\r?\n/).filter(Boolean);
    if (refs.length === 0) {
      return;
    }
    await this.run("git", ["update-ref", "--stdin"], {
      cwd: directory,
      input: `${refs.map((ref) => `delete ${ref}`).join("\n")}\n`,
      reject: true,
    });
  }

  async hasLfs(directory: string): Promise<boolean> {
    try {
      const result = await this.run(
        "git",
        ["lfs", "ls-files", "--all", "--name-only"],
        { cwd: directory, reject: true },
      );
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async fetchAllLfs(directory: string, token: string): Promise<void> {
    await this.execute(["lfs", "fetch", "--all"], { cwd: directory, reject: true }, token);
  }

  async pushAllLfs(
    directory: string,
    targetUrl: string,
    token: string,
  ): Promise<void> {
    await this.execute(
      ["lfs", "push", "--all", authenticatedUrl(targetUrl, token)],
      { cwd: directory, reject: true },
      token,
    );
  }
}
