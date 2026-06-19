import { Octokit } from "@octokit/rest";
import { execa } from "execa";

import { ForkNeoError } from "../utils/errors.js";

type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string }>;

const defaultRunner: CommandRunner = async (file, args) => execa(file, args);

export async function resolveGitHubToken(
  env: NodeJS.ProcessEnv = process.env,
  run: CommandRunner = defaultRunner,
): Promise<string> {
  const configured = env.GITHUB_TOKEN?.trim();
  if (configured) {
    return configured;
  }

  try {
    const result = await run("gh", ["auth", "token"]);
    const token = result.stdout.trim();
    if (token) {
      return token;
    }
  } catch {
    // The actionable error below covers both a missing gh executable and no gh login.
  }

  throw new ForkNeoError(
    "AUTH_REQUIRED",
    "GitHub authentication is required.",
    "Set GITHUB_TOKEN or run `gh auth login`.",
  );
}

export async function createGitHubClient(): Promise<{
  token: string;
  octokit: Octokit;
}> {
  const token = await resolveGitHubToken();
  return { token, octokit: new Octokit({ auth: token }) };
}
