import { describe, expect, it, vi } from "vitest";

import { GitHubRepositoryService } from "../../src/github/repos.js";

function fakeRepository(overrides: Record<string, unknown> = {}) {
  return {
    name: "project",
    full_name: "alex/project",
    owner: { login: "alex" },
    fork: true,
    private: false,
    visibility: "public",
    archived: false,
    size: 42,
    language: "TypeScript",
    default_branch: "main",
    pushed_at: "2026-06-19T00:00:00Z",
    license: { spdx_id: "MIT" },
    description: "Example",
    clone_url: "https://github.com/alex/project.git",
    html_url: "https://github.com/alex/project",
    parent: { full_name: "upstream/project" },
    ...overrides,
  };
}

describe("GitHubRepositoryService", () => {
  it("lists only forks and maps scan metadata", async () => {
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        fakeRepository(),
        fakeRepository({ name: "original", full_name: "alex/original", fork: false }),
      ]),
      rest: { repos: { listForAuthenticatedUser: vi.fn() } },
    };
    const service = new GitHubRepositoryService(octokit as never);

    await expect(service.listForks()).resolves.toEqual([
      expect.objectContaining({
        fullName: "alex/project",
        parentFullName: "upstream/project",
        defaultBranch: "main",
        license: "MIT",
      }),
    ]);
  });

  it("loads a repository state for verification", async () => {
    const octokit = {
      paginate: vi
        .fn()
        .mockResolvedValueOnce([{ name: "main" }, { name: "release" }])
        .mockResolvedValueOnce([{ name: "v1" }]),
      rest: {
        repos: {
          listBranches: vi.fn(),
          listTags: vi.fn(),
          getCommit: vi.fn().mockResolvedValue({ data: { sha: "abc123" } }),
        },
      },
    };
    const service = new GitHubRepositoryService(octokit as never);

    await expect(
      service.getRepositoryState({
        owner: "alex",
        repo: "project",
        fullName: "alex/project",
      }, "main"),
    ).resolves.toEqual({
      latestCommit: "abc123",
      branches: ["main", "release"],
      tags: ["v1"],
    });
  });
});
