import path from "node:path";

import fs from "fs-extra";

export interface MigrationReportData {
  source: string;
  target: string;
  sourceUrl: string;
  targetUrl: string;
  defaultBranch: string;
  branchCount: number;
  tagCount: number;
  lfsMigrated: boolean;
  verified: boolean;
  completedAt: Date;
}

function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value.replace(/x-access-token:[^@]+@/g, "");
  }
}

export function formatMigrationReport(data: MigrationReportData): string {
  return `# ForkNeo Migration Report

| Field | Value |
| --- | --- |
| Source | ${data.source} |
| Target | ${data.target} |
| Source URL | ${publicUrl(data.sourceUrl)} |
| Target URL | ${publicUrl(data.targetUrl)} |
| Default branch | ${data.defaultBranch} |
| Branches | ${data.branchCount} |
| Tags | ${data.tagCount} |
| Git LFS | ${data.lfsMigrated ? "Migrated" : "Not detected"} |
| Verification | ${data.verified ? "Passed" : "Failed"} |
| Completed at | ${data.completedAt.toISOString()} |
`;
}

export async function writeMigrationReport(
  data: MigrationReportData,
  reportsDirectory = path.resolve(".forkneo", "reports"),
): Promise<string> {
  await fs.ensureDir(reportsDirectory);
  const filename = `${data.target.replace("/", "-")}-report.md`;
  const outputPath = path.join(reportsDirectory, filename);
  await fs.writeFile(outputPath, formatMigrationReport(data), "utf8");
  return outputPath;
}
