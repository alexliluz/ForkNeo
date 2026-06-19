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
});
