import { describe, expect, it, vi } from "vitest";

import { runVerify } from "../../src/commands/verify.js";

const target = {
  owner: "alex",
  name: "project-neo",
  fullName: "alex/project-neo",
  isFork: false,
  defaultBranch: "main",
};

describe("runVerify", () => {
  it("accepts an independent repository", async () => {
    const github = {
      getRepository: vi.fn().mockResolvedValue(target),
      getRepositoryState: vi.fn().mockResolvedValue({
        latestCommit: "abc",
        branches: ["main"],
        tags: ["v1"],
      }),
    };

    await expect(runVerify("alex/project-neo", {}, { github } as never)).resolves.toMatchObject({
      verified: true,
      branchCount: 1,
      tagCount: 1,
    });
  });

  it("rejects a repository that is still a fork", async () => {
    const github = { getRepository: vi.fn().mockResolvedValue({ ...target, isFork: true }) };
    await expect(runVerify("alex/project-neo", {}, { github } as never)).rejects.toMatchObject({
      code: "TARGET_IS_FORK",
    });
  });

  it("rejects source comparison differences", async () => {
    const github = {
      getRepository: vi
        .fn()
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce({ ...target, fullName: "alex/project" }),
      getRepositoryState: vi
        .fn()
        .mockResolvedValueOnce({ latestCommit: "def", branches: ["main"], tags: [] })
        .mockResolvedValueOnce({ latestCommit: "abc", branches: ["main"], tags: ["v1"] }),
    };

    await expect(
      runVerify("alex/project-neo", { source: "alex/project" }, { github } as never),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });
});
