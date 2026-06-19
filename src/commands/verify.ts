import type { GitHubService } from "../types/index.js";
import { ForkNeoError } from "../utils/errors.js";
import { parseRepository } from "../utils/names.js";
import { compareRepositoryState } from "../utils/verify.js";

export interface VerifyOptions {
  source?: string;
}

export interface VerifyDependencies {
  github: GitHubService;
}

export interface VerifyResult {
  verified: true;
  target: string;
  latestCommit: string;
  branchCount: number;
  tagCount: number;
}

export async function runVerify(
  targetValue: string,
  options: VerifyOptions,
  dependencies: VerifyDependencies,
): Promise<VerifyResult> {
  const targetReference = parseRepository(targetValue);
  const target = await dependencies.github.getRepository(targetReference);
  if (target.isFork) {
    throw new ForkNeoError(
      "TARGET_IS_FORK",
      `${target.fullName} is still a GitHub fork.`,
      "Verify the independent target repository rather than the original fork.",
    );
  }

  const targetState = await dependencies.github.getRepositoryState(
    targetReference,
    target.defaultBranch,
  );

  if (options.source) {
    const sourceReference = parseRepository(options.source);
    const source = await dependencies.github.getRepository(sourceReference);
    const sourceState = await dependencies.github.getRepositoryState(
      sourceReference,
      source.defaultBranch,
    );
    const comparison = compareRepositoryState(sourceState, targetState);
    if (!comparison.matches) {
      throw new ForkNeoError(
        "VERIFICATION_FAILED",
        `Verification failed for ${target.fullName}:\n${comparison.differences.join("\n")}`,
        "Inspect the missing refs and rerun the mirror push before verifying again.",
      );
    }
  }

  return {
    verified: true,
    target: target.fullName,
    latestCommit: targetState.latestCommit,
    branchCount: targetState.branches.length,
    tagCount: targetState.tags.length,
  };
}
