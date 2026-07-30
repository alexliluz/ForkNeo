import type { Options } from "execa";

import { ForkNeoError } from "../utils/errors.js";

type CommandResult = { stdout: string; stderr: string };

export type LfsCommandRunner = (
  file: string,
  args: string[],
  options: Options,
) => Promise<CommandResult>;

export async function inspectGitLfs(
  directory: string,
  run: LfsCommandRunner,
): Promise<boolean> {
  try {
    await run("git", ["lfs", "version"], {
      cwd: directory,
      reject: true,
    });
  } catch (error) {
    throw new ForkNeoError(
      "GIT_LFS_UNAVAILABLE",
      "Git LFS is required to inspect a source mirror safely.",
      "Install Git LFS, run `git lfs version`, then retry. No target repository was created.",
      { cause: error },
    );
  }

  let listing: CommandResult;
  try {
    listing = await run(
      "git",
      ["lfs", "ls-files", "--all", "--name-only"],
      { cwd: directory, reject: true },
    );
  } catch (error) {
    throw new ForkNeoError(
      "GIT_LFS_INSPECTION_FAILED",
      "Git LFS could not inspect all objects in the source mirror.",
      "Repair the mirror or Git LFS installation, then retry. No target repository was created.",
      { cause: error },
    );
  }

  return listing.stdout.trim().length > 0;
}
