import { describe, expect, it, vi } from "vitest";

import { runConvert } from "../../src/commands/convert.js";

function repository(overrides: Record<string, unknown> = {}) {
  return {
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
    pushedAt: null,
    license: "MIT",
    description: "Example",
    cloneUrl: "https://github.com/alex/project.git",
    htmlUrl: "https://github.com/alex/project",
    parentFullName: "upstream/project",
    ...overrides,
  };
}

describe("runConvert", () => {
  it("rejects a source that is not a fork", async () => {
    const github = { getRepository: vi.fn().mockResolvedValue(repository({ isFork: false })) };
    await expect(
      runConvert("alex/project", {}, { github } as never),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FORK" });
  });

  it("migrates refs and LFS, verifies, and writes a report", async () => {
    const source = repository();
    const target = repository({
      name: "project-neo",
      fullName: "alex/project-neo",
      isFork: false,
      cloneUrl: "https://github.com/alex/project-neo.git",
      htmlUrl: "https://github.com/alex/project-neo",
    });
    const state = { latestCommit: "abc", branches: ["main", "release"], tags: ["v1"] };
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      createRepository: vi.fn().mockResolvedValue(target),
      setDefaultBranch: vi.fn().mockResolvedValue(undefined),
      getRepositoryState: vi.fn().mockResolvedValue(state),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      pushMirror: vi.fn(),
      hasLfs: vi.fn().mockResolvedValue(true),
      fetchAllLfs: vi.fn(),
      pushAllLfs: vi.fn(),
    };
    const writeReport = vi.fn().mockResolvedValue("report.md");
    const deps = {
      github,
      git,
      token: "secret",
      confirm: vi.fn().mockResolvedValue(true),
      withTemp: async (work: (directory: string) => Promise<unknown>) => work("C:/tmp/work"),
      writeReport,
      now: () => new Date("2026-06-19T01:00:00Z"),
    };

    const result = await runConvert("alex/project", {}, deps as never);

    expect(git.cloneMirror).toHaveBeenCalledWith(source.cloneUrl, expect.any(String), "secret");
    expect(git.pruneUnsupportedRefs).toHaveBeenCalled();
    expect(git.pushMirror).toHaveBeenCalledWith(expect.any(String), target.cloneUrl, "secret");
    expect(git.fetchAllLfs).toHaveBeenCalled();
    expect(git.fetchAllLfs).toHaveBeenCalledWith(
      expect.any(String),
      source.cloneUrl,
      "secret",
    );
    expect(git.pushAllLfs).toHaveBeenCalled();
    expect(github.setDefaultBranch).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "alex/project-neo" }),
      "main",
    );
    expect(writeReport).toHaveBeenCalledWith(expect.objectContaining({ verified: true }));
    expect(result.reportPath).toBe("report.md");
  });
});
