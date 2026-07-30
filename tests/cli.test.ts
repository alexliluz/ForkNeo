import { describe, expect, it, vi } from "vitest";

import { createProgram, formatCliError } from "../src/cli.js";
import { ForkNeoError } from "../src/utils/errors.js";

function repository(overrides: Record<string, unknown> = {}) {
  return {
    owner: "alex",
    name: "project",
    fullName: "alex/project",
    isFork: true,
    isPrivate: false,
    visibility: "public",
    archived: false,
    size: 42,
    language: "TypeScript",
    defaultBranch: "main",
    pushedAt: null,
    license: "MIT",
    description: "Example",
    cloneUrl: "https://github.com/alex/project.git",
    htmlUrl: "https://github.com/alex/project",
    parentFullName: "upstream/project",
    ...overrides,
  };
}

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
    expect(convert?.options.map((option) => option.long)).toContain("--dry-run");
  });

  it("prints a read-only dry-run summary without conversion success output", async () => {
    const write = vi.fn();
    const github = {
      getRepository: vi.fn().mockResolvedValue(repository()),
      getCurrentUser: vi.fn().mockResolvedValue("alex"),
      repositoryExists: vi.fn().mockResolvedValue(false),
      getRepositoryState: vi.fn().mockResolvedValue({
        defaultBranch: "main",
        refs: {
          "refs/heads/main": "abc",
          "refs/heads/release": "def",
          "refs/tags/v1": "tag-object",
        },
      }),
      createRepository: vi.fn(),
      setDefaultBranch: vi.fn(),
    };
    const git = {
      cloneMirror: vi.fn(),
      pruneUnsupportedRefs: vi.fn(),
      hasLfs: vi.fn().mockResolvedValue(true),
      fetchAllLfs: vi.fn(),
      pushMirror: vi.fn(),
      pushAllLfs: vi.fn(),
    };
    const confirm = vi.fn();
    const program = createProgram({
      github,
      git,
      token: "token",
      confirm,
      write,
    } as never);

    await program.parseAsync([
      "node",
      "forkneo",
      "convert",
      "alex/project",
      "--name",
      "project-independent",
      "--dry-run",
    ]);

    const output = write.mock.calls
      .map(([line]) => String(line))
      .join("\n");
    expect(output).toContain(
      "Dry run passed: alex/project -> alex/project-independent",
    );
    expect(output).toContain("Default branch: main");
    expect(output).toContain("Refs: 3");
    expect(output).toContain("Git LFS: detected");
    expect(output).toContain("Remote changes: none");
    expect(output).not.toContain("Converted");
    expect(output).not.toContain("Report:");
    expect(confirm).not.toHaveBeenCalled();
    expect(git.fetchAllLfs).not.toHaveBeenCalled();
    expect(github.createRepository).not.toHaveBeenCalled();
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
