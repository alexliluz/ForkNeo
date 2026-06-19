import { describe, expect, it, vi } from "vitest";

import { resolveGitHubToken } from "../../src/github/client.js";

describe("resolveGitHubToken", () => {
  it("prefers GITHUB_TOKEN", async () => {
    const runGh = vi.fn();

    await expect(resolveGitHubToken({ GITHUB_TOKEN: " env-token " }, runGh)).resolves.toBe(
      "env-token",
    );
    expect(runGh).not.toHaveBeenCalled();
  });

  it("falls back to gh auth token", async () => {
    const runGh = vi.fn().mockResolvedValue({ stdout: "gh-token\n" });

    await expect(resolveGitHubToken({}, runGh)).resolves.toBe("gh-token");
    expect(runGh).toHaveBeenCalledWith("gh", ["auth", "token"]);
  });

  it("returns an actionable error when no token is available", async () => {
    const runGh = vi.fn().mockRejectedValue(new Error("not installed"));

    await expect(resolveGitHubToken({}, runGh)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      hint: expect.stringMatching(/GITHUB_TOKEN/),
    });
  });
});
