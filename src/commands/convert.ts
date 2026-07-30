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

export interface ConvertResult {
  source: string;
  target: string;
  reportPath: string;
  lfsMigrated: boolean;
}

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

  if (!options.yes) {
    const accepted = await dependencies.confirm(
      `Create ${targetReference.fullName} and mirror ${source.fullName} into it?`,
    );
    if (!accepted) {
      throw new ForkNeoError("CANCELLED", "Conversion cancelled.");
    }
  }

  const target = await dependencies.github.createRepository({
    name: targetName,
    description: source.description ?? undefined,
    isPrivate: source.isPrivate,
  });

  const useTemp = dependencies.withTemp ?? withTempDirectory;
  const saveReport = dependencies.writeReport ?? writeMigrationReport;
  const now = dependencies.now ?? (() => new Date());

  try {
    return await useTemp(async (directory) => {
      const mirrorDirectory = path.join(directory, `${targetName}.git`);
      await dependencies.git.cloneMirror(source.cloneUrl, mirrorDirectory, dependencies.token);
      await dependencies.git.pruneUnsupportedRefs(mirrorDirectory);
      const lfsMigrated = await dependencies.git.hasLfs(mirrorDirectory);
      if (lfsMigrated) {
        await dependencies.git.fetchAllLfs(
          mirrorDirectory,
          source.cloneUrl,
          dependencies.token,
        );
      }
      await dependencies.git.pushMirror(mirrorDirectory, target.cloneUrl, dependencies.token);
      if (lfsMigrated) {
        await dependencies.git.pushAllLfs(
          mirrorDirectory,
          target.cloneUrl,
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
        target: target.fullName,
        sourceUrl: source.cloneUrl,
        targetUrl: target.htmlUrl,
        defaultBranch: source.defaultBranch,
        refCount: Object.keys(targetState.refs).length,
        lfsMigrated,
        verified: true,
        completedAt: now(),
      });

      return {
        source: source.fullName,
        target: target.fullName,
        reportPath,
        lfsMigrated,
      };
    });
  } catch (error) {
    if (error instanceof ForkNeoError) {
      throw error;
    }
    throw new ForkNeoError(
      "CONVERSION_FAILED",
      `Conversion failed after creating ${target.fullName}. The remote repository was kept.`,
      "Review the error, fix the cause, then retry with a new target name or complete the mirror push manually.",
      { cause: error },
    );
  }
}
