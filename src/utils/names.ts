import { z } from "zod";

import { ForkNeoError } from "./errors.js";

const namePattern = /^[A-Za-z0-9_.-]+$/;
const repositorySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

export interface RepositoryReference {
  owner: string;
  repo: string;
  fullName: string;
}

export function parseRepository(value: string): RepositoryReference {
  const parsed = repositorySchema.safeParse(value);
  if (!parsed.success) {
    throw new ForkNeoError(
      "INVALID_REPOSITORY",
      `Repository must use the owner/repo format: ${value}`,
    );
  }

  const [owner, repo] = parsed.data.split("/") as [string, string];
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export interface TargetNameOptions {
  name?: string;
  suffix?: string;
}

export function buildTargetName(
  sourceName: string,
  options: TargetNameOptions,
): string {
  const suffix = (options.suffix ?? "neo").replace(/^-+/, "");
  const target = options.name ?? `${sourceName}-${suffix}`;

  if (!target || !namePattern.test(target)) {
    throw new ForkNeoError(
      "INVALID_TARGET_NAME",
      `Invalid target repository name: ${target}`,
    );
  }

  return target;
}
