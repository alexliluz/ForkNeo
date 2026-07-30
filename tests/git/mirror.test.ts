import { describe, expect, it, vi } from "vitest";

import { ShellGitService } from "../../src/git/mirror.js";

describe("ShellGitService", () => {
  it("keeps credentials out of mirror command arguments and repository URLs", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const git = new ShellGitService(run);

    await git.cloneMirror(
      "https://github.com/a/source.git",
      "C:/tmp/repo.git",
      "secret",
    );
    await git.pushMirror(
      "C:/tmp/repo.git",
      "https://github.com/a/target.git",
      "secret",
    );

    expect(run).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "clone",
        "--mirror",
        "https://github.com/a/source.git",
        "C:/tmp/repo.git",
      ],
      expect.objectContaining({
        extendEnv: false,
        env: expect.objectContaining({
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_KEY_0:
            "http.https://github.com/a/source.git.extraHeader",
        }),
      }),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "git",
      ["push", "--mirror", "https://github.com/a/target.git"],
      expect.objectContaining({
        cwd: "C:/tmp/repo.git",
        extendEnv: false,
        env: expect.objectContaining({
          GIT_CONFIG_KEY_0:
            "http.https://github.com/a/target.git.extraHeader",
        }),
      }),
    );

    for (const [, args] of run.mock.calls) {
      expect(args.join(" ")).not.toContain("secret");
      expect(args.join(" ")).not.toContain("x-access-token");
    }
  });

  it("sanitizes raw and derived credentials from failures and causes", async () => {
    const basicCredential = Buffer.from(
      "x-access-token:token/value",
      "utf8",
    ).toString("base64");
    const run = vi.fn().mockRejectedValue(
      new Error(
        [
          "token/value",
          "token%2Fvalue",
          basicCredential,
          `Authorization: Basic ${basicCredential}`,
        ].join(" "),
      ),
    );
    const git = new ShellGitService(run);

    const failure = (await git
      .cloneMirror(
        "https://github.com/a/source.git",
        "C:/tmp/repo.git",
        "token/value",
      )
      .catch(
        (error: unknown) =>
          error as Error & { code: string; cause?: unknown },
      )) as Error & { code: string; cause?: unknown };

    expect(failure).toMatchObject({ code: "GIT_COMMAND_FAILED" });
    expect(String(failure)).not.toContain("token/value");
    expect(String(failure)).not.toContain("token%2Fvalue");
    expect(String(failure)).not.toContain(basicCredential);
    expect(String(failure.cause)).not.toContain("token/value");
    expect(String(failure.cause)).not.toContain(basicCredential);
  });

  it("detects and migrates Git LFS objects", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "filter=lfs diff=lfs merge=lfs -text\n", stderr: "" })
      .mockResolvedValue({ stdout: "", stderr: "" });
    const git = new ShellGitService(run);

    await expect(git.hasLfs("C:/tmp/repo.git")).resolves.toBe(true);
    await git.fetchAllLfs(
      "C:/tmp/repo.git",
      "https://github.com/a/source.git",
      "secret",
    );
    await git.pushAllLfs(
      "C:/tmp/repo.git",
      "https://github.com/a/target.git",
      "secret",
    );

    expect(run).toHaveBeenCalledWith(
      "git",
      ["lfs", "fetch", "--all", "origin"],
      expect.objectContaining({
        cwd: "C:/tmp/repo.git",
        extendEnv: false,
        env: expect.objectContaining({
          GIT_CONFIG_KEY_0:
            "http.https://github.com/a/source.git.extraHeader",
        }),
      }),
    );
    expect(run).toHaveBeenCalledWith(
      "git",
      ["lfs", "push", "--all", "https://github.com/a/target.git"],
      expect.objectContaining({
        cwd: "C:/tmp/repo.git",
        extendEnv: false,
        env: expect.objectContaining({
          GIT_CONFIG_KEY_0:
            "http.https://github.com/a/target.git.extraHeader",
        }),
      }),
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
