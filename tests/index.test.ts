import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isDirectExecution } from "../src/index.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "forkneo-entry-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("isDirectExecution", () => {
  it("recognizes the canonical module path", async () => {
    const directory = await createTemporaryDirectory();
    const modulePath = join(directory, "index.js");
    await writeFile(modulePath, "");

    expect(
      isDirectExecution(modulePath, pathToFileURL(modulePath).href),
    ).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "recognizes a symlink to the module path",
    async () => {
      const directory = await createTemporaryDirectory();
      const modulePath = join(directory, "index.js");
      const binPath = join(directory, "forkneo");
      await writeFile(modulePath, "");
      await symlink(modulePath, binPath);

      expect(
        isDirectExecution(binPath, pathToFileURL(modulePath).href),
      ).toBe(true);
    },
  );

  it("rejects a different existing file", async () => {
    const directory = await createTemporaryDirectory();
    const modulePath = join(directory, "index.js");
    const otherPath = join(directory, "other.js");
    await Promise.all([
      writeFile(modulePath, ""),
      writeFile(otherPath, ""),
    ]);

    expect(
      isDirectExecution(otherPath, pathToFileURL(modulePath).href),
    ).toBe(false);
  });

  it("rejects missing and unresolvable entry paths", async () => {
    const directory = await createTemporaryDirectory();
    const modulePath = join(directory, "index.js");
    await writeFile(modulePath, "");

    expect(
      isDirectExecution(undefined, pathToFileURL(modulePath).href),
    ).toBe(false);
    expect(
      isDirectExecution(
        join(directory, "missing.js"),
        pathToFileURL(modulePath).href,
      ),
    ).toBe(false);
    expect(isDirectExecution(modulePath, "https://example.com/index.js"))
      .toBe(false);
  });
});
