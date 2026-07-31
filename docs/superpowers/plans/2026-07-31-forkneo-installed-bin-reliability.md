# ForkNeo Installed Bin Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the packed and installed ForkNeo command execute reliably
through npm's platform-specific `.bin` entry and prove it in every CI matrix
job.

**Architecture:** Keep the existing single TypeScript entrypoint, but compare
the invoked entry and module file by canonical native filesystem path. Add a
Node-based package smoke test that builds, packs, installs, verifies the
installed `.bin`, and invokes it through the current npm CLI without
constructing shell command strings.

**Tech Stack:** Node.js 22/24/26, TypeScript 5.9, Vitest 4, tsup 8, npm 11,
GitHub Actions.

## Global Constraints

- Keep `dist/index.js` as the only production entrypoint.
- Preserve import safety: importing `src/index.ts` must not start the CLI.
- Return `false` when direct-execution path resolution fails.
- Do not change command behavior, authentication, Git operations, output
  formats, package version, or Node.js `>=22` requirement.
- The package smoke test must pack the current source and install that exact
  tarball in a new temporary directory.
- Execute the installed command through npm's `.bin` resolution, not by
  calling the installed `dist/index.js` directly.
- Assert meaningful `--help` output and exact package-version output.
- Keep the existing Ubuntu/macOS/Windows and Node 22/24/26 CI matrix.
- Do not publish to npm or create registry credentials in this plan.
- Deliver runtime code, regression coverage, CI, and matching documentation
  in one pull request.

---

## File Map

- Create `tests/index.test.ts`: unit coverage for canonical direct-execution
  detection, symlink handling, and fail-safe false cases.
- Modify `src/index.ts`: expose and use the canonical-path predicate.
- Create `scripts/smoke-installed-package.mjs`: cross-platform pack, install,
  installed-bin, help, version, and cleanup gate.
- Modify `package.json`: add the package smoke scripts without changing
  dependencies or version.
- Modify `.github/workflows/ci.yml`: run the installed package gate in every
  matrix job while retaining the direct built-file diagnostic.
- Modify `README.md`: document the package-boundary verification command.

### Task 1: Canonical Entry Detection and Package Regression Gate

**Files:**

- Create: `tests/index.test.ts`
- Create: `scripts/smoke-installed-package.mjs`
- Modify: `src/index.ts:1-33`
- Modify: `package.json:28-34`

**Interfaces:**

- Consumes:
  - `process.argv[1]`
  - `import.meta.url`
  - `process.env.npm_execpath`
  - package metadata at `package.json`
- Produces:
  - `isDirectExecution(argvEntry: string | undefined, moduleUrl: string):
    boolean`
  - npm script `test:package`
  - a package smoke process that exits non-zero on any pack, install, help,
    version, or cleanup-boundary failure

- [ ] **Step 1: Add failing direct-execution tests**

Create `tests/index.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify the RED state**

Run:

```bash
npm test -- tests/index.test.ts
```

Expected: FAIL during import because `src/index.ts` does not export
`isDirectExecution`.

- [ ] **Step 3: Add the installed-package smoke script**

Create `scripts/smoke-installed-package.mjs`:

```js
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("Run the installed-package smoke test through npm.");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} exited with status ${result.status}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result.stdout.trim();
}

function runNpm(args, cwd) {
  return run(process.execPath, [npmCli, ...args], cwd);
}

const workspace = await mkdtemp(join(tmpdir(), "forkneo-package-smoke-"));
const packDirectory = join(workspace, "pack");
const installDirectory = join(workspace, "install");

try {
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(installDirectory, { recursive: true }),
  ]);

  const packResult = JSON.parse(
    runNpm(
      ["pack", "--json", "--pack-destination", packDirectory],
      packageRoot,
    ),
  );
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error("npm pack did not return exactly one package.");
  }

  const tarball = join(packDirectory, packResult[0].filename);
  const packagedFiles = packResult[0].files.map(({ path }) => path);
  if (!packagedFiles.includes("dist/index.js")) {
    throw new Error("Packed artifact is missing dist/index.js.");
  }

  runNpm(
    [
      "install",
      "--prefix",
      installDirectory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    workspace,
  );

  const installedBin = join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "forkneo.cmd" : "forkneo",
  );
  await access(installedBin);

  const help = runNpm(
    [
      "exec",
      "--prefix",
      installDirectory,
      "--offline",
      "--",
      "forkneo",
      "--help",
    ],
    workspace,
  );
  if (!help.includes("Usage: forkneo [options] [command]")) {
    throw new Error("Installed forkneo --help did not print CLI usage.");
  }

  const version = runNpm(
    [
      "exec",
      "--prefix",
      installDirectory,
      "--offline",
      "--",
      "forkneo",
      "--version",
    ],
    workspace,
  );
  if (version !== packageMetadata.version) {
    throw new Error(
      `Installed version ${JSON.stringify(version)} does not match ` +
        `${JSON.stringify(packageMetadata.version)}.`,
    );
  }

  console.log(
    `Installed forkneo ${version} passed help and version smoke tests.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
```

- [ ] **Step 4: Add self-contained package scripts**

Add these two keys to `package.json` immediately after `test`:

```json
"pretest:package": "npm run build",
"test:package": "node scripts/smoke-installed-package.mjs",
```

The resulting script block must be:

```json
"scripts": {
  "build": "tsup",
  "dev": "tsx src/index.ts",
  "test": "vitest run",
  "pretest:package": "npm run build",
  "test:package": "node scripts/smoke-installed-package.mjs",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

Do not modify `package-lock.json`; npm lockfiles do not store package scripts.

- [ ] **Step 5: Run the package smoke test and verify its RED state**

Run:

```bash
npm run test:package
```

Expected: FAIL with
`Installed forkneo --help did not print CLI usage.` The pre-hook build itself
must pass first.

- [ ] **Step 6: Implement canonical direct-execution detection**

Replace the `node:url` import at the top of `src/index.ts` with:

```ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
```

Insert this function before `main`:

```ts
export function isDirectExecution(
  argvEntry: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argvEntry) {
    return false;
  }

  try {
    return (
      realpathSync.native(argvEntry) ===
      realpathSync.native(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}
```

Replace the current constant and conditional:

```ts
const isDirectExecution =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
```

with:

```ts
if (isDirectExecution(process.argv[1], import.meta.url)) {
```

Keep the existing `main().catch(...)` error boundary unchanged.

- [ ] **Step 7: Run focused GREEN verification**

Run:

```bash
npm test -- tests/index.test.ts
npm run test:package
node dist/index.js --help
node dist/index.js --version
```

Expected:

- four predicate tests pass on POSIX;
- three pass and the symlink-specific test is skipped on Windows;
- installed package smoke prints
  `Installed forkneo 0.3.0 passed help and version smoke tests.`;
- direct help prints the usage line;
- direct version prints `0.3.0`.

- [ ] **Step 8: Run the complete local code gate**

Run:

```bash
npm test
npm run typecheck
npm run test:package
npm pack --dry-run
git diff --check
```

Expected:

- 14 test files pass with 76 tests on POSIX;
- type checking exits zero;
- installed help and version smoke passes;
- the pack listing contains `dist/index.js`, `dist/index.d.ts`,
  `dist/index.js.map`, `LICENSE`, `README.md`, and `package.json`, with no
  source or test files;
- diff check is clean.

- [ ] **Step 9: Commit runtime and regression coverage**

Run:

```bash
git add src/index.ts tests/index.test.ts \
  scripts/smoke-installed-package.mjs package.json
git diff --cached --check
git diff --cached --stat
git commit -m "fix: run CLI through installed npm bin"
```

Expected: one commit containing the canonical predicate, its unit tests, the
installed-package smoke script, and the two npm scripts.

### Task 2: CI and Developer Verification Contract

**Files:**

- Modify: `.github/workflows/ci.yml:40-49`
- Modify: `README.md:278-290`

**Interfaces:**

- Consumes:
  - npm script `test:package` from Task 1
  - existing nine-job CI matrix
- Produces:
  - package-boundary verification in every matrix job
  - a documented local command matching CI

- [ ] **Step 1: Update the CI validation steps**

Replace:

```yaml
      - name: Build CLI
        run: npm run build
      - name: Smoke-test built CLI
        run: node dist/index.js --help
```

with:

```yaml
      - name: Build and smoke-test installed package
        run: npm run test:package
      - name: Smoke-test built CLI directly
        run: node dist/index.js --help
```

The package script's npm pre-hook performs the production build before pack
and install. Keep all existing permissions, action pins, matrix values,
concurrency, and aggregate `CI` job unchanged.

- [ ] **Step 2: Update the development verification commands**

Replace the README development block:

```bash
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

with:

```bash
npm test
npm run typecheck
npm run test:package
node dist/index.js --help
```

Add this paragraph immediately after the block:

```markdown
`npm run test:package` builds ForkNeo, packs the current source, installs the
tarball in an isolated temporary directory, and runs the installed
`forkneo --help` and `forkneo --version` commands. This catches package-bin
and symlink behavior that direct `dist/index.js` execution does not cover.
```

Do not add global npm installation instructions before registry publication.

- [ ] **Step 3: Verify workflow and documentation scope**

Run:

```bash
rg -n \
  "ubuntu-latest|macos-latest|windows-latest|22|24|26|contents: read|npm ci|npm test|typecheck|test:package|dist/index.js --help|name: CI" \
  .github/workflows/ci.yml
rg -n "test:package|tarball|forkneo --help|forkneo --version" README.md
git diff --check
git diff -- .github/workflows/ci.yml README.md
```

Expected:

- all three operating systems and Node majors remain;
- least-privilege permissions and the stable `CI` job remain;
- every matrix job runs the package smoke;
- README explains the package boundary;
- no registry install or publication claim is added.

- [ ] **Step 4: Run the final local delivery gate**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run test:package
node dist/index.js --help
node dist/index.js --version
npm pack --dry-run
git diff --check
git status --short
```

Expected: every command exits zero; the only uncommitted files are
`.github/workflows/ci.yml` and `README.md`.

- [ ] **Step 5: Commit the CI and documentation contract**

Run:

```bash
git add .github/workflows/ci.yml README.md
git diff --cached --check
git diff --cached --stat
git commit -m "test: verify installed package in CI"
```

Expected: one commit limited to the CI steps and matching development
documentation.

### Task 3: Pull Request Delivery and External Verification

**Files:**

- No production file changes expected.
- Temporary PR body: project `.tmp/forkneo-installed-bin-pr.md`
- Execution ledger:
  `outputs/github-achievements-execution-ledger.md` in the parent task
  workspace

**Interfaces:**

- Consumes:
  - clean branch `fix/npm-installed-bin`
  - design commit
  - Task 1 and Task 2 commits
  - local verification evidence
- Produces:
  - one public ForkNeo pull request owned by `alexliluz`
  - complete nine-job matrix and stable `CI` result
  - traceable execution-ledger entry

- [ ] **Step 1: Perform the pre-push audit**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git config --get user.name
git config --get user.email
gh auth status
gh pr list --repo alexliluz/ForkNeo --state open \
  --json number,title,headRefName,url
```

Expected:

- worktree is clean;
- exactly the design, runtime/test, and CI/docs commits are ahead;
- identity is
  `alexliluz <49665315+alexliluz@users.noreply.github.com>`;
- active GitHub account is `alexliluz`;
- no existing open PR covers this branch or defect.

- [ ] **Step 2: Push the branch**

Run:

```bash
git push -u origin fix/npm-installed-bin
```

Expected: remote branch head equals local `HEAD`.

- [ ] **Step 3: Create one pull request**

Create `.tmp/forkneo-installed-bin-pr.md` with:

```markdown
## Summary

- resolve npm's installed bin symlink before deciding whether to run the CLI
- add unit coverage for direct, symlinked, different, and missing entry paths
- pack and install the real tarball, then smoke-test `forkneo --help` and
  `forkneo --version` in every CI matrix job

## Reproduction

ForkNeo v0.3.0 passed the existing direct smoke test, but a fresh tarball
install produced exit code 0 with no output for both installed commands:

```text
node_modules/.bin/forkneo --help     # 0 bytes
node_modules/.bin/forkneo --version  # 0 bytes
```

Running the installed `dist/index.js` directly printed normal help, which
isolated the defect to the direct-execution comparison across npm's POSIX
symlink.

## Verification

- `npm ci`
- `npm test`
- `npm run typecheck`
- `npm run test:package`
- `node dist/index.js --help`
- `node dist/index.js --version`
- `npm pack --dry-run`

## Scope

This does not publish to npm or change package version, commands,
authentication, migration behavior, output formats, or supported Node
versions.

AI assistance: OpenAI Codex was used to inspect the packaging behavior, draft
the design and tests, and run the recorded verification. The maintainer
reviewed the resulting diff and evidence.
```

Then run:

```bash
gh pr create --repo alexliluz/ForkNeo \
  --base main \
  --head fix/npm-installed-bin \
  --title "Fix installed npm bin execution" \
  --body-file .tmp/forkneo-installed-bin-pr.md
```

Expected: one non-draft PR authored by `alexliluz`.

- [ ] **Step 4: Inspect the public PR and CI**

Run:

```bash
gh pr view --repo alexliluz/ForkNeo --json \
  number,url,state,isDraft,author,headRefOid,files,commits,reviewDecision
gh pr checks --repo alexliluz/ForkNeo --watch --interval 20
```

Expected:

- PR is open and non-draft;
- author is `alexliluz`;
- files match the design, plan, runtime, tests, script, package metadata, CI,
  and README;
- all nine validation jobs and stable `CI` check pass.

If a check fails, inspect the failing job, correct the technical issue on the
same branch, rerun the complete relevant local gate, commit the correction,
push, and wait for the replacement CI run. Do not bypass or disable checks.

- [ ] **Step 5: Review the final diff and merge only on evidence**

Run:

```bash
git fetch origin main
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
gh pr diff --repo alexliluz/ForkNeo
gh pr checks --repo alexliluz/ForkNeo
```

Verify:

- canonical comparison is fail-safe and has no import side effect;
- package smoke executes npm's installed bin resolution;
- temporary cleanup is limited to the directory created by the script;
- no token, registry credential, publish step, or unrelated refactor exists;
- CI and local evidence are green.

Then merge with the repository's normal merge-commit strategy:

```bash
gh pr merge --repo alexliluz/ForkNeo --merge
```

Expected: PR state becomes `MERGED`, and the merge commit is present on
`origin/main`.

- [ ] **Step 6: Record and verify the delivery**

Update the parent execution ledger with:

- baseline RED output;
- selected canonical-path design and rejected alternatives;
- design and plan commit IDs;
- runtime, test, CI, and documentation commit IDs;
- local gate results;
- PR URL, CI results, and merge commit;
- explicit statement that no npm publication or registry identity was
  created.

Run:

```bash
gh pr view --repo alexliluz/ForkNeo --json \
  number,url,state,mergedAt,mergeCommit,author,commits,files
gh api repos/alexliluz/ForkNeo/commits/main --jq \
  '{sha,author:.author.login,committer:.committer.login}'
git status --short --branch
```

Expected: merged PR and main commit are attributed to `alexliluz`; the feature
worktree is clean; the ledger contains no secrets or unsupported completion
claims.
