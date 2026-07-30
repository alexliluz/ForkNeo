import { describe, expect, it, vi } from "vitest";

import { runScan } from "../../src/commands/scan.js";

describe("runScan", () => {
  it("returns fork metadata", async () => {
    const repository = {
      owner: "alex",
      name: "project",
      fullName: "alex/project",
      isFork: true,
      isPrivate: false,
      visibility: "public",
      archived: false,
      size: 42,
      language: "TypeScript",
      defaultBranch: "main",
      pushedAt: "2026-06-19T00:00:00Z",
      license: "MIT",
      description: "Example",
      cloneUrl: "https://github.com/alex/project.git",
      htmlUrl: "https://github.com/alex/project",
      parentFullName: "upstream/project",
    };
    const github = {
      listForks: vi.fn().mockResolvedValue([repository]),
    };

    await expect(runScan(github as never)).resolves.toEqual({
      repositories: [repository],
    });
  });

  it("returns an empty repository array when no forks are found", async () => {
    await expect(
      runScan({ listForks: vi.fn().mockResolvedValue([]) } as never),
    ).resolves.toEqual({ repositories: [] });
  });
});
