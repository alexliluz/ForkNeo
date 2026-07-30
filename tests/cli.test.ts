import { describe, expect, it, vi } from "vitest";

import { createProgram, formatCliError } from "../src/cli.js";
import { ForkNeoError } from "../src/utils/errors.js";

describe("createProgram", () => {
  it("registers scan, convert, and verify commands", () => {
    const program = createProgram({
      github: {},
      git: {},
      token: "token",
      confirm: vi.fn(),
      write: vi.fn(),
    } as never);

    expect(program.commands.map((command) => command.name())).toEqual([
      "scan",
      "convert",
      "verify",
    ]);
    expect(program.name()).toBe("forkneo");
  });

  it("defaults the convert suffix to neo", () => {
    const program = createProgram({
      github: {},
      git: {},
      token: "token",
      confirm: vi.fn(),
      write: vi.fn(),
    } as never);
    const convert = program.commands.find((command) => command.name() === "convert");
    expect(convert?.getOptionValue("suffix")).toBe("neo");
  });

  it("reports the verified default branch and exact ref count", async () => {
    const write = vi.fn();
    const program = createProgram({
      github: {
        getRepository: vi.fn().mockResolvedValue({
          fullName: "alex/project-neo",
          isFork: false,
        }),
        getRepositoryState: vi.fn().mockResolvedValue({
          defaultBranch: "main",
          refs: {
            "refs/heads/main": "abc",
            "refs/tags/v1": "tag-object",
          },
        }),
      },
      git: {},
      token: "token",
      confirm: vi.fn(),
      write,
    } as never);

    await program.parseAsync([
      "node",
      "forkneo",
      "verify",
      "alex/project-neo",
    ]);

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining(
        "Verified alex/project-neo: default branch main, 2 refs",
      ),
    );
  });
});

describe("formatCliError", () => {
  it("includes a recovery hint for known errors", () => {
    expect(
      formatCliError(new ForkNeoError("AUTH_REQUIRED", "Login required", "Run gh auth login")),
    ).toBe("Login required\nHint: Run gh auth login");
  });

  it("keeps unexpected errors concise", () => {
    expect(formatCliError(new Error("boom"))).toBe("Unexpected error: boom");
  });
});
