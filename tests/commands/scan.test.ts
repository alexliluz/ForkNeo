import { describe, expect, it, vi } from "vitest";

import { runScan } from "../../src/commands/scan.js";

describe("runScan", () => {
  it("renders fork metadata", async () => {
    const write = vi.fn();
    const github = {
      listForks: vi.fn().mockResolvedValue([
        {
          fullName: "alex/project",
          parentFullName: "upstream/project",
          visibility: "public",
          archived: false,
          size: 42,
          language: "TypeScript",
          defaultBranch: "main",
          pushedAt: "2026-06-19T00:00:00Z",
          license: "MIT",
        },
      ]),
    };

    await runScan(github as never, write);

    expect(write).toHaveBeenCalledWith(expect.stringContaining("alex/project"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("upstream/project"));
  });

  it("explains when no forks are found", async () => {
    const write = vi.fn();
    await runScan({ listForks: vi.fn().mockResolvedValue([]) } as never, write);
    expect(write).toHaveBeenCalledWith("No fork repositories found.");
  });
});
