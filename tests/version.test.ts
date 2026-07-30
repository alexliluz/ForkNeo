import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli.js";
import { VERSION } from "../src/version.js";

async function readJson(relativeUrl: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(relativeUrl, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

describe("release metadata", () => {
  it("keeps package, lockfile, and CLI versions at v0.2.0", async () => {
    const packageJson = await readJson("../package.json");
    const packageLock = await readJson("../package-lock.json");
    const lockPackages = packageLock.packages as Record<
      string,
      Record<string, unknown>
    >;

    expect(VERSION).toBe("0.2.0");
    expect(packageJson.version).toBe(VERSION);
    expect(packageLock.version).toBe(VERSION);
    expect(lockPackages[""].version).toBe(VERSION);
  });

  it("requires Node.js 22 or newer in package and lockfile", async () => {
    const packageJson = await readJson("../package.json");
    const packageLock = await readJson("../package-lock.json");
    const lockPackages = packageLock.packages as Record<
      string,
      Record<string, unknown>
    >;

    expect(packageJson.engines).toEqual({ node: ">=22" });
    expect(lockPackages[""].engines).toEqual({ node: ">=22" });
  });

  it("uses the shared version in the CLI", () => {
    const program = createProgram({
      github: {},
      git: {},
      token: "token",
      confirm: () => Promise.resolve(false),
      write: () => undefined,
    } as never);

    expect(program.version()).toBe(VERSION);
  });
});
