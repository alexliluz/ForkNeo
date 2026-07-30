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

  it("loads exact head and tag object SHAs for verification", async () => {
    const octokit = {
      paginate: vi
        .fn()
        .mockResolvedValueOnce([
          { ref: "refs/heads/main", object: { sha: "commit-main" } },
          { ref: "refs/heads/release", object: { sha: "commit-release" } },
        ])
        .mockResolvedValueOnce([
          { ref: "refs/tags/v1", object: { sha: "annotated-tag-object" } },
        ]),
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({
            data: { default_branch: "main" },
          }),
        },
        git: {
          listMatchingRefs: vi.fn(),
        },
      },
    };
    const service = new GitHubRepositoryService(octokit as never);

    await expect(
      service.getRepositoryState({
        owner: "alex",
        repo: "project",
        fullName: "alex/project",
      }),
    ).resolves.toEqual({
      defaultBranch: "main",
      refs: {
        "refs/heads/main": "commit-main",
        "refs/heads/release": "commit-release",
        "refs/tags/v1": "annotated-tag-object",
      },
    });

    expect(octokit.paginate).toHaveBeenNthCalledWith(
      1,
      octokit.rest.git.listMatchingRefs,
      {
        owner: "alex",
        repo: "project",
        ref: "heads/",
        per_page: 100,
      },
    );
    expect(octokit.paginate).toHaveBeenNthCalledWith(
      2,
      octokit.rest.git.listMatchingRefs,
      {
        owner: "alex",
        repo: "project",
        ref: "tags/",
        per_page: 100,
      },
    );
  });
});
