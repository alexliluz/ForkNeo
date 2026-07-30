import { describe, expect, it } from "vitest";

import { formatMigrationReport } from "../../src/utils/report.js";

describe("formatMigrationReport", () => {
  it("records migration facts without credentials", () => {
    const report = formatMigrationReport({
      source: "alex/project",
      target: "alex/project-neo",
      sourceUrl: "https://x-access-token:secret@github.com/alex/project.git",
      targetUrl: "https://github.com/alex/project-neo",
      defaultBranch: "main",
      refCount: 5,
      lfsMigrated: true,
      verified: true,
      completedAt: new Date("2026-06-19T01:00:00.000Z"),
    });

    expect(report).toContain("# ForkNeo Migration Report");
    expect(report).toContain("alex/project-neo");
    expect(report).toContain("Git LFS | Migrated");
    expect(report).toContain("Verified refs | 5");
    expect(report).not.toContain("Branches |");
    expect(report).not.toContain("Tags |");
    expect(report).not.toContain("secret");
  });
});
