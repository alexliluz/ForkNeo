import { describe, expect, it, vi } from "vitest";

import { inspectGitLfs } from "../../src/git/lfs.js";

describe("inspectGitLfs", () => {
  it("returns false only after a successful empty listing", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "git-lfs/3.7.0",
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "\n", stderr: "" });

    await expect(inspectGitLfs("C:/tmp/repo.git", run)).resolves.toBe(false);

    expect(run).toHaveBeenNthCalledWith(
      1,
      "git",
      ["lfs", "version"],
      { cwd: "C:/tmp/repo.git", reject: true },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "git",
      ["lfs", "ls-files", "--all", "--name-only"],
      { cwd: "C:/tmp/repo.git", reject: true },
    );
  });

  it("returns true when the successful listing contains an object", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "git-lfs/3.7.0",
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: "fixtures/archive.bin\n",
        stderr: "",
      });

    await expect(inspectGitLfs("/tmp/repo.git", run)).resolves.toBe(true);
  });

  it("raises an actionable error when Git LFS is unavailable", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("git: 'lfs' is not a command"));

    await expect(inspectGitLfs("/tmp/repo.git", run)).rejects.toMatchObject({
      code: "GIT_LFS_UNAVAILABLE",
      hint: expect.stringMatching(/install Git LFS/i),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("raises an actionable error when object inspection fails", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "git-lfs/3.7.0",
        stderr: "",
      })
      .mockRejectedValueOnce(new Error("corrupt pointer"));

    await expect(inspectGitLfs("/tmp/repo.git", run)).rejects.toMatchObject({
      code: "GIT_LFS_INSPECTION_FAILED",
      hint: expect.stringMatching(/no refs or LFS objects were pushed/i),
    });
  });
});
