import { describe, expect, it, vi } from "vitest";

import { runConvert } from "../../src/commands/convert.js";
import { ForkNeoError } from "../../src/utils/errors.js";

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

  it("rejects an existing target before starting local preflight", async () => {
    const github = {
      getRepository: vi.fn().mockResolvedValue(repository()),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(true),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn(),
    };

    await expect(
      runConvert(
        "alex/project",
        { dryRun: true },
        {
          github,
          git,
          token: "secret",
          confirm: vi.fn(),
        } as never,
      ),
    ).rejects.toMatchObject({ code: "TARGET_EXISTS" });

    expect(git.cloneMirror).not.toHaveBeenCalled();
    expect(git.pruneUnsupportedRefs).not.toHaveBeenCalled();
    expect(git.hasLfs).not.toHaveBeenCalled();
  });

  it("preflights a conversion without confirmation, remote writes, or LFS download", async () => {
    const source = repository();
    const state = {
      defaultBranch: "main",
      refs: {
        "refs/heads/main": "abc",
        "refs/heads/release": "def",
        "refs/tags/v1": "tag-object",
      },
    };
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      getRepositoryState: vi.fn().mockResolvedValue(state),
      createRepository: vi
        .fn()
        .mockRejectedValue(new Error("createRepository must not be called")),
      setDefaultBranch: vi.fn(),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn().mockResolvedValue(true),
      fetchAllLfs: vi.fn(),
      pushMirror: vi.fn(),
      pushAllLfs: vi.fn(),
    };
    const confirm = vi.fn().mockResolvedValue(true);
    const writeReport = vi.fn();

    const result = await runConvert(
      "alex/project",
      { dryRun: true },
      {
        github,
        git,
        token: "secret",
        confirm,
        withTemp: async (work: (directory: string) => Promise<unknown>) =>
          work("C:/tmp/work"),
        writeReport,
      } as never,
    );

    expect(result).toEqual({
      mode: "dry-run",
      source: "alex/project",
      target: "alex/project-neo",
      defaultBranch: "main",
      refCount: 3,
      lfsDetected: true,
    });
    expect(git.cloneMirror).toHaveBeenCalledWith(
      source.cloneUrl,
      expect.any(String),
      "secret",
    );
    expect(git.pruneUnsupportedRefs).toHaveBeenCalled();
    expect(git.hasLfs).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(git.fetchAllLfs).not.toHaveBeenCalled();
    expect(github.createRepository).not.toHaveBeenCalled();
    expect(git.pushMirror).not.toHaveBeenCalled();
    expect(git.pushAllLfs).not.toHaveBeenCalled();
    expect(github.setDefaultBranch).not.toHaveBeenCalled();
    expect(writeReport).not.toHaveBeenCalled();
  });

  it("stops before every push when Git LFS inspection fails", async () => {
    const source = repository();
    const target = repository({
      name: "project-neo",
      fullName: "alex/project-neo",
      isFork: false,
      cloneUrl: "https://github.com/alex/project-neo.git",
      htmlUrl: "https://github.com/alex/project-neo",
    });
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      createRepository: vi.fn().mockResolvedValue(target),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn().mockRejectedValue(
        new ForkNeoError(
          "GIT_LFS_INSPECTION_FAILED",
          "Git LFS could not inspect all objects in the source mirror.",
          "Repair Git LFS, then retry. No target repository was created.",
        ),
      ),
      fetchAllLfs: vi.fn(),
      pushMirror: vi.fn(),
      pushAllLfs: vi.fn(),
    };

    await expect(
      runConvert(
        "alex/project",
        { yes: true },
        {
          github,
          git,
          token: "secret",
          confirm: vi.fn(),
          withTemp: async (work: (directory: string) => Promise<unknown>) =>
            work("C:/tmp/work"),
        } as never,
      ),
    ).rejects.toMatchObject({ code: "GIT_LFS_INSPECTION_FAILED" });

    expect(git.cloneMirror).toHaveBeenCalled();
    expect(git.pruneUnsupportedRefs).toHaveBeenCalled();
    expect(github.createRepository).not.toHaveBeenCalled();
    expect(git.fetchAllLfs).not.toHaveBeenCalled();
    expect(git.pushMirror).not.toHaveBeenCalled();
    expect(git.pushAllLfs).not.toHaveBeenCalled();
  });

  it("reports an unexpected clone failure before target creation", async () => {
    const source = repository();
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      createRepository: vi.fn(),
    };
    const git = {
      cloneMirror: vi.fn().mockRejectedValue(new Error("clone unavailable")),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn(),
    };

    await expect(
      runConvert(
        "alex/project",
        { yes: true },
        {
          github,
          git,
          token: "secret",
          confirm: vi.fn(),
          withTemp: async (work: (directory: string) => Promise<unknown>) =>
            work("C:/tmp/work"),
        } as never,
      ),
    ).rejects.toMatchObject({
      code: "CONVERSION_PREFLIGHT_FAILED",
      message: expect.stringContaining("before creating alex/project-neo"),
      hint: expect.stringMatching(/no target repository was created/i),
    });

    expect(github.createRepository).not.toHaveBeenCalled();
  });

  it("fetches source LFS objects before creating the target", async () => {
    const source = repository();
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      createRepository: vi.fn(),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn().mockResolvedValue(true),
      fetchAllLfs: vi.fn().mockRejectedValue(new Error("LFS source unavailable")),
      pushMirror: vi.fn(),
      pushAllLfs: vi.fn(),
    };

    await expect(
      runConvert(
        "alex/project",
        { yes: true },
        {
          github,
          git,
          token: "secret",
          confirm: vi.fn(),
          withTemp: async (work: (directory: string) => Promise<unknown>) =>
            work("C:/tmp/work"),
        } as never,
      ),
    ).rejects.toMatchObject({
      code: "CONVERSION_PREFLIGHT_FAILED",
      hint: expect.stringMatching(/no target repository was created/i),
    });

    expect(git.fetchAllLfs).toHaveBeenCalled();
    expect(github.createRepository).not.toHaveBeenCalled();
    expect(git.pushMirror).not.toHaveBeenCalled();
    expect(git.pushAllLfs).not.toHaveBeenCalled();
  });

  it("requires a remote check when the create request outcome is uncertain", async () => {
    const source = repository();
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      createRepository: vi.fn().mockRejectedValue(new Error("request timed out")),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn().mockResolvedValue(false),
      fetchAllLfs: vi.fn(),
    };

    await expect(
      runConvert(
        "alex/project",
        { yes: true },
        {
          github,
          git,
          token: "secret",
          confirm: vi.fn(),
          withTemp: async (work: (directory: string) => Promise<unknown>) =>
            work("C:/tmp/work"),
        } as never,
      ),
    ).rejects.toMatchObject({
      code: "TARGET_CREATION_UNCERTAIN",
      message: expect.stringMatching(/alex\/project-neo.*may have been created/i),
      hint: expect.stringMatching(/inspect.*before retrying/i),
    });

    expect(git.cloneMirror).toHaveBeenCalled();
    expect(git.hasLfs).toHaveBeenCalled();
    expect(github.createRepository).toHaveBeenCalled();
  });

  it("adds retained-target guidance to typed post-creation failures", async () => {
    const source = repository();
    const target = repository({
      name: "project-neo",
      fullName: "alex/project-neo",
      isFork: false,
      cloneUrl: "https://github.com/alex/project-neo.git",
      htmlUrl: "https://github.com/alex/project-neo",
    });
    const github = {
      getRepository: vi.fn().mockResolvedValue(source),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      createRepository: vi.fn().mockResolvedValue(target),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn().mockResolvedValue(false),
      fetchAllLfs: vi.fn(),
      pushMirror: vi.fn().mockRejectedValue(
        new ForkNeoError(
          "GIT_COMMAND_FAILED",
          "Git mirror push failed.",
          "Check Git authentication.",
        ),
      ),
      pushAllLfs: vi.fn(),
    };

    await expect(
      runConvert(
        "alex/project",
        { yes: true },
        {
          github,
          git,
          token: "secret",
          confirm: vi.fn(),
          withTemp: async (work: (directory: string) => Promise<unknown>) =>
            work("C:/tmp/work"),
        } as never,
      ),
    ).rejects.toMatchObject({
      code: "GIT_COMMAND_FAILED",
      message: "Git mirror push failed.",
      hint: expect.stringMatching(
        /check Git authentication[\s\S]*alex\/project-neo[\s\S]*kept/i,
      ),
    });
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
    const state = {
      defaultBranch: "main",
      refs: {
        "refs/heads/main": "abc",
        "refs/heads/release": "def",
        "refs/tags/v1": "tag-object",
      },
    };
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

    expect(result.mode).toBe("converted");
    if (result.mode !== "converted") {
      throw new Error("Expected a completed conversion result.");
    }
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
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        verified: true,
        refCount: 3,
      }),
    );
    expect(result.reportPath).toBe("report.md");
  });
});
