import { describe, expect, it, vi } from "vitest";

import { ShellGitService } from "../../src/git/mirror.js";

describe("ShellGitService", () => {
  it("clones and pushes a mirror with argument arrays", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const git = new ShellGitService(run);

    await git.cloneMirror("https://github.com/a/source.git", "C:/tmp/repo.git", "secret");
    await git.pushMirror("C:/tmp/repo.git", "https://github.com/a/target.git", "secret");

    expect(run).toHaveBeenNthCalledWith(
      1,
      "git",
      ["clone", "--mirror", "https://x-access-token:secret@github.com/a/source.git", "C:/tmp/repo.git"],
      expect.any(Object),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "git",
      ["push", "--mirror", "https://x-access-token:secret@github.com/a/target.git"],
      expect.objectContaining({ cwd: "C:/tmp/repo.git" }),
    );
  });

  it("redacts credentials from failures", async () => {
    const run = vi.fn().mockRejectedValue(
      new Error("failed https://x-access-token:secret@github.com/a/source.git"),
    );
    const git = new ShellGitService(run);

    await expect(
      git.cloneMirror("https://github.com/a/source.git", "C:/tmp/repo.git", "secret"),
    ).rejects.not.toThrow(/secret/);
  });

  it("detects and migrates Git LFS objects", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "filter=lfs diff=lfs merge=lfs -text\n", stderr: "" })
      .mockResolvedValue({ stdout: "", stderr: "" });
    const git = new ShellGitService(run);

    await expect(git.hasLfs("C:/tmp/repo.git")).resolves.toBe(true);
    await git.fetchAllLfs("C:/tmp/repo.git", "secret");
    await git.pushAllLfs(
      "C:/tmp/repo.git",
      "https://github.com/a/target.git",
      "secret",
    );

    expect(run).toHaveBeenCalledWith(
      "git",
      ["lfs", "fetch", "--all"],
      expect.objectContaining({ cwd: "C:/tmp/repo.git" }),
    );
    expect(run).toHaveBeenCalledWith(
      "git",
      ["lfs", "push", "--all", "https://x-access-token:secret@github.com/a/target.git"],
      expect.objectContaining({ cwd: "C:/tmp/repo.git" }),
    );
  });

  it("removes GitHub pull request refs before a mirror push", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "refs/pull/1/head\nrefs/pull/2/merge\n",
        stderr: "",
      })
      .mockResolvedValue({ stdout: "", stderr: "" });
    const git = new ShellGitService(run);

    await git.pruneUnsupportedRefs("C:/tmp/repo.git");

    expect(run).toHaveBeenCalledWith(
      "git",
      ["update-ref", "--stdin"],
      expect.objectContaining({
        cwd: "C:/tmp/repo.git",
        input: "delete refs/pull/1/head\ndelete refs/pull/2/merge\n",
      }),
    );
  });
});
