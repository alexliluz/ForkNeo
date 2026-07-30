import path from "node:path";

import type { GitHubService, GitService } from "../types/index.js";
import { ForkNeoError } from "../utils/errors.js";
import { buildTargetName, parseRepository } from "../utils/names.js";
import {
  writeMigrationReport,
  type MigrationReportData,
} from "../utils/report.js";
import { withTempDirectory } from "../utils/temp.js";
import { compareRepositoryState } from "../utils/verify.js";

export interface ConvertOptions {
  name?: string;
  suffix?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export interface ConvertDependencies {
  github: GitHubService;
  git: GitService;
  token: string;
  confirm: (message: string) => Promise<boolean>;
  withTemp?: typeof withTempDirectory;
  writeReport?: (data: MigrationReportData) => Promise<string>;
  now?: () => Date;
}

export interface DryRunResult {
  mode: "dry-run";
  source: string;
  target: string;
  defaultBranch: string;
  refCount: number;
  lfsDetected: boolean;
}

export interface ConvertedResult {
  mode: "converted";
  source: string;
  target: string;
  reportPath: string;
  lfsMigrated: boolean;
}

export type ConvertResult = DryRunResult | ConvertedResult;

export async function runConvert(
  sourceValue: string,
  options: ConvertOptions,
  dependencies: ConvertDependencies,
): Promise<ConvertResult> {
  const sourceReference = parseRepository(sourceValue);
  const source = await dependencies.github.getRepository(sourceReference);
  if (!source.isFork) {
    throw new ForkNeoError(
      "SOURCE_NOT_FORK",
      `${source.fullName} is not a GitHub fork.`,
      "Use convert only with repositories whose GitHub fork flag is true.",
    );
  }

  const targetName = buildTargetName(source.name, options);
  const targetOwner = await dependencies.github.getCurrentUser();
  const targetReference = parseRepository(`${targetOwner}/${targetName}`);
  if (await dependencies.github.repositoryExists(targetReference)) {
    throw new ForkNeoError(
      "TARGET_EXISTS",
      `Target repository already exists: ${targetReference.fullName}`,
      "Choose another --name or --suffix.",
    );
  }

  if (!options.dryRun && !options.yes) {
    const accepted = await dependencies.confirm(
      `Create ${targetReference.fullName} and mirror ${source.fullName} into it?`,
    );
    if (!accepted) {
      throw new ForkNeoError("CANCELLED", "Conversion cancelled.");
    }
  }

  const useTemp = dependencies.withTemp ?? withTempDirectory;
  const saveReport = dependencies.writeReport ?? writeMigrationReport;
  const now = dependencies.now ?? (() => new Date());
  let target:
    | Awaited<ReturnType<GitHubService["createRepository"]>>
    | undefined;
  let creationAttempted = false;

  try {
    const dryRunSourceState = options.dryRun
      ? await dependencies.github.getRepositoryState(sourceReference)
      : null;

    return await useTemp(async (directory) => {
      const mirrorDirectory = path.join(directory, `${targetName}.git`);
      await dependencies.git.cloneMirror(source.cloneUrl, mirrorDirectory, dependencies.token);
      await dependencies.git.pruneUnsupportedRefs(mirrorDirectory);
      const lfsDetected = await dependencies.git.hasLfs(mirrorDirectory);

      if (dryRunSourceState !== null) {
        return {
          mode: "dry-run",
          source: source.fullName,
          target: targetReference.fullName,
          defaultBranch: dryRunSourceState.defaultBranch,
          refCount: Object.keys(dryRunSourceState.refs).length,
          lfsDetected,
        };
      }

      if (lfsDetected) {
        await dependencies.git.fetchAllLfs(
          mirrorDirectory,
          source.cloneUrl,
          dependencies.token,
        );
      }

      creationAttempted = true;
      const createdTarget = await dependencies.github.createRepository({
        name: targetName,
        description: source.description ?? undefined,
        isPrivate: source.isPrivate,
      });
      target = createdTarget;

      await dependencies.git.pushMirror(
        mirrorDirectory,
        createdTarget.cloneUrl,
        dependencies.token,
      );
      if (lfsDetected) {
        await dependencies.git.pushAllLfs(
          mirrorDirectory,
          createdTarget.cloneUrl,
          dependencies.token,
        );
      }

      await dependencies.github.setDefaultBranch(targetReference, source.defaultBranch);
      const [sourceState, targetState] = await Promise.all([
        dependencies.github.getRepositoryState(sourceReference),
        dependencies.github.getRepositoryState(targetReference),
      ]);
      const comparison = compareRepositoryState(sourceState, targetState);
      if (!comparison.matches) {
        throw new ForkNeoError(
          "VERIFICATION_FAILED",
          `Migration verification failed:\n${comparison.differences.join("\n")}`,
        );
      }

      const reportPath = await saveReport({
        source: source.fullName,
        target: createdTarget.fullName,
        sourceUrl: source.cloneUrl,
        targetUrl: createdTarget.htmlUrl,
        defaultBranch: source.defaultBranch,
        refCount: Object.keys(targetState.refs).length,
        lfsMigrated: lfsDetected,
        verified: true,
        completedAt: now(),
      });

      return {
        mode: "converted",
        source: source.fullName,
        target: createdTarget.fullName,
        reportPath,
        lfsMigrated: lfsDetected,
      };
    });
  } catch (error) {
    if (target) {
      if (error instanceof ForkNeoError) {
        const retainedTargetHint =
          `Target ${target.fullName} was kept for explicit recovery; ForkNeo did not delete it.`;
        throw new ForkNeoError(
          error.code,
          error.message,
          error.hint
            ? `${error.hint} ${retainedTargetHint}`
            : retainedTargetHint,
          { cause: error },
        );
      }
      throw new ForkNeoError(
        "CONVERSION_FAILED",
        `Conversion failed after creating ${target.fullName}. The remote repository was kept.`,
        "Review the error, fix the cause, then retry with a new target name or complete the mirror push manually.",
        { cause: error },
      );
    }
    if (creationAttempted) {
      throw new ForkNeoError(
        "TARGET_CREATION_UNCERTAIN",
        `Conversion failed while creating ${targetReference.fullName}; it may have been created even though GitHub did not return a successful response.`,
        `Inspect ${targetReference.fullName} on GitHub before retrying or choosing a new target name.`,
        { cause: error },
      );
    }
    if (error instanceof ForkNeoError) {
      throw error;
    }
    throw new ForkNeoError(
      "CONVERSION_PREFLIGHT_FAILED",
      `Conversion preflight failed before creating ${targetReference.fullName}.`,
      "Review the cause, fix the source or local tooling, then retry. No target repository was created.",
      { cause: error },
    );
  }
}
