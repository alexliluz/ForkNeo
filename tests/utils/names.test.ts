import { describe, expect, it } from "vitest";

import { buildTargetName, parseRepository } from "../../src/utils/names.js";

describe("parseRepository", () => {
  it("parses an owner and repository name", () => {
    expect(parseRepository("octocat/hello-world")).toEqual({
      owner: "octocat",
      repo: "hello-world",
      fullName: "octocat/hello-world",
    });
  });

  it.each(["hello-world", "a/b/c", "/repo", "owner/", "owner/re po"])(
    "rejects invalid repository identifier %s",
    (value) => {
      expect(() => parseRepository(value)).toThrow(/owner\/repo/i);
    },
  );
});

describe("buildTargetName", () => {
  it("uses an explicit name before the suffix", () => {
    expect(
      buildTargetName("project", { name: "independent", suffix: "next" }),
    ).toBe("independent");
  });

  it("uses neo as the default suffix", () => {
    expect(buildTargetName("project", {})).toBe("project-neo");
  });

  it("normalizes a suffix with a leading dash", () => {
    expect(buildTargetName("project", { suffix: "-next" })).toBe(
      "project-next",
    );
  });

  it("rejects an invalid target name", () => {
    expect(() => buildTargetName("project", { name: "bad name" })).toThrow(
      /target repository name/i,
    );
  });

  it("accepts a target name at GitHub's 100-character boundary", () => {
    const target = "a".repeat(100);
    expect(buildTargetName("project", { name: target })).toBe(target);
  });

  it("rejects an explicit target name over GitHub's 100-character limit", () => {
    expect(() =>
      buildTargetName("project", { name: "a".repeat(101) }),
    ).toThrow(/100 characters/i);
  });

  it("rejects a default suffix that pushes the target over the limit", () => {
    expect(() => buildTargetName("a".repeat(100), {})).toThrow(
      /100 characters/i,
    );
  });
});
