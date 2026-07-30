import { describe, expect, it, vi } from "vitest";

import { runVerify } from "../../src/commands/verify.js";

const target = {
  owner: "alex",
  name: "project-neo",
  fullName: "alex/project-neo",
  isFork: false,
  defaultBranch: "main",
};

const matchingState = {
  defaultBranch: "main",
  refs: {
    "refs/heads/main": "abc",
    "refs/tags/v1": "tag-object",
  },
};

describe("runVerify", () => {
  it("accepts an independent repository and reports exact ref count", async () => {
    const github = {
      getRepository: vi.fn().mockResolvedValue(target),
      getRepositoryState: vi.fn().mockResolvedValue(matchingState),
    };

    await expect(
      runVerify("alex/project-neo", {}, { github } as never),
    ).resolves.toEqual({
      verified: true,
      target: "alex/project-neo",
      defaultBranch: "main",
      refCount: 2,
    });
  });

  it("rejects a repository that is still a fork", async () => {
    const github = {
      getRepository: vi.fn().mockResolvedValue({ ...target, isFork: true }),
    };

    await expect(
      runVerify("alex/project-neo", {}, { github } as never),
    ).rejects.toMatchObject({ code: "TARGET_IS_FORK" });
  });

  it("rejects one mismatched ref object", async () => {
    const github = {
      getRepository: vi
        .fn()
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce({
          ...target,
          fullName: "alex/project",
          isFork: true,
        }),
      getRepositoryState: vi
        .fn()
        .mockResolvedValueOnce({
          ...matchingState,
          refs: {
            ...matchingState.refs,
            "refs/tags/v1": "target-tag-object",
          },
        })
        .mockResolvedValueOnce(matchingState),
    };

    await expect(
      runVerify(
        "alex/project-neo",
        { source: "alex/project" },
        { github } as never,
      ),
    ).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
      message: expect.stringContaining("Ref object differs for refs/tags/v1"),
    });
  });
});
