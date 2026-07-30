import { describe, expect, it } from "vitest";

import { compareRepositoryState } from "../../src/utils/verify.js";

describe("compareRepositoryState", () => {
  it("accepts the same default branch and exact ref-object map", () => {
    expect(
      compareRepositoryState(
        {
          defaultBranch: "main",
          refs: {
            "refs/heads/main": "aaa",
            "refs/heads/release": "bbb",
            "refs/tags/v1": "tag-object",
          },
        },
        {
          defaultBranch: "main",
          refs: {
            "refs/tags/v1": "tag-object",
            "refs/heads/release": "bbb",
            "refs/heads/main": "aaa",
          },
        },
      ),
    ).toEqual({ matches: true, differences: [] });
  });

  it("reports default, missing, unexpected, and mismatched refs deterministically", () => {
    const result = compareRepositoryState(
      {
        defaultBranch: "main",
        refs: {
          "refs/heads/main": "aaa",
          "refs/heads/release": "bbb",
          "refs/tags/v1": "tag-source",
        },
      },
      {
        defaultBranch: "trunk",
        refs: {
          "refs/heads/extra": "ccc",
          "refs/heads/main": "aaa",
          "refs/tags/v1": "tag-target",
        },
      },
    );

    expect(result).toEqual({
      matches: false,
      differences: [
        "Default branch differs: source main, target trunk",
        "Unexpected target ref refs/heads/extra -> ccc",
        "Missing target ref refs/heads/release -> bbb",
        "Ref object differs for refs/tags/v1: source tag-source, target tag-target",
      ],
    });
  });
});
