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
