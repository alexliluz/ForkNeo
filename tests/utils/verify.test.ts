import { describe, expect, it } from "vitest";

import { compareRepositoryState } from "../../src/utils/verify.js";

describe("compareRepositoryState", () => {
  it("reports matching commits and refs", () => {
    expect(
      compareRepositoryState(
        { latestCommit: "abc", branches: ["main", "release"], tags: ["v1"] },
        { latestCommit: "abc", branches: ["release", "main"], tags: ["v1"] },
      ),
    ).toEqual({ matches: true, differences: [] });
  });

  it("describes commit, branch, and tag differences", () => {
    const result = compareRepositoryState(
      { latestCommit: "abc", branches: ["main", "release"], tags: ["v1"] },
      { latestCommit: "def", branches: ["main", "preview"], tags: [] },
    );

    expect(result.matches).toBe(false);
    expect(result.differences).toEqual([
      "Latest default-branch commit differs: source abc, target def",
      "Missing target branches: release",
      "Extra target branches: preview",
      "Missing target tags: v1",
    ]);
  });
});
