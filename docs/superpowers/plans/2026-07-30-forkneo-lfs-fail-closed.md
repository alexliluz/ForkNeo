# ForkNeo Git LFS Fail-Closed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `convert` stop before any mirror push whenever Git LFS availability or source-object inspection cannot be trusted.

**Architecture:** A focused `inspectGitLfs` adapter first verifies the executable with `git lfs version`, then distinguishes a successful empty `git lfs ls-files` result from a failed inspection. `ShellGitService` delegates to it, while conversion tests prove the existing stage ordering prevents refs or LFS objects from being pushed after inspection failure.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Execa 9, Vitest 4, Git LFS CLI.

## Global Constraints

- Use Node.js `>=22`.
- `convert` requires a functioning Git LFS executable even when the inspected repository has no LFS objects.
- Return `false` only after `git lfs version` and `git lfs ls-files --all --name-only` both succeed and the listing is empty.
- Stop before `git push --mirror` when Git LFS availability or inspection fails.
- Preserve the target repository after any post-creation failure; do not add automatic deletion.
- Keep Git LFS fetch and push authentication child-only and credential-free as implemented by the credential transport hardening plan.
- Do not claim a failure occurred before target creation: at this stage the target exists, but no refs or LFS objects have been pushed.
- Credit `ASEnough` only for a reproduction, test, documentation change, or review it actually performs.

---

## File Map

- Replace `src/git/lfs.ts`: own Git LFS availability and source-object inspection with typed errors.
- Create `tests/git/lfs.test.ts`: cover missing executable, failed inspection, empty repository, and detected objects.
- Modify `src/git/mirror.ts`: delegate `hasLfs` to the fail-closed helper instead of swallowing failures.
- Modify `tests/git/mirror.test.ts`: assert delegation-visible command order through the injected runner.
- Modify `tests/commands/convert.test.ts`: prove inspection failure prevents fetch and every push.
- Modify `README.md`: make Git LFS a requirement for `convert` and explain the pre-push recovery boundary.

## Execution Prerequisites

- Start after the credential transport hardening pull request is merged.
- Create `fix/lfs-fail-closed` from the current protected default branch only after branch creation is authorized.
- Use Node.js 22 or newer with npm and run `npm ci` from the committed lockfile.
- Confirm `git --version` for unit-test execution. A local Git LFS installation is not required for mocked unit tests, but it is required for later end-to-end acceptance.

### Task 0: Record the Silent-Skip Reliability Defect

**Files:**

- External GitHub issue.

**Interfaces:**

- Consumes: the v0.1.0 `hasLfs` catch-all behavior.
- Produces: one genuine reliability issue owned by `alexliluz`.

- [ ] **Step 1: Check for an equivalent issue**

Run:

```bash
gh issue list \
  --repo alexliluz/ForkNeo \
  --state all \
  --search '"Git LFS" inspection failure in:title,body' \
  --json number,title,state,url
```

Expected: no existing issue already covers a failed LFS command being treated as an empty listing. Reuse an equivalent issue instead of duplicating it.

- [ ] **Step 2: Create the reliability issue**

After separate issue-creation authorization, run:

```bash
gh issue create \
  --repo alexliluz/ForkNeo \
  --title "Reliability: fail closed when Git LFS inspection fails" \
  --body '## Problem

ForkNeo v0.1.0 catches every `git lfs ls-files` failure and returns `false`.
A missing or broken Git LFS installation can therefore let conversion continue
without migrating objects stored outside Git.

## Required behavior

- verify `git lfs version` before inspection
- return false only after a successful empty all-object listing
- use distinct actionable errors for unavailable Git LFS and failed inspection
- stop before every mirror or LFS push
- retain the already-created target for explicit recovery

## Verification

Mocked tests must cover unavailable, failed, empty, and non-empty outcomes and
prove that the conversion orchestrator performs no push after failure.'
```

Expected: one technically meaningful issue authored by `alexliluz`.

### Task 1: Typed Git LFS Inspection

**Files:**

- Create: `tests/git/lfs.test.ts`
- Modify: `src/git/lfs.ts`

**Interfaces:**

- Consumes: an injected `LfsCommandRunner` with the same structural signature as `ShellGitService`'s runner.
- Produces:
  - `LfsCommandRunner(file: string, args: string[], options: Options): Promise<CommandResult>`.
  - `inspectGitLfs(directory: string, run: LfsCommandRunner): Promise<boolean>`.
  - `ForkNeoError` code `GIT_LFS_UNAVAILABLE` for a failed version probe.
  - `ForkNeoError` code `GIT_LFS_INSPECTION_FAILED` for a failed object listing.

- [ ] **Step 1: Write the fail-closed Git LFS tests**

Create `tests/git/lfs.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import { inspectGitLfs } from "../../src/git/lfs.js";

describe("inspectGitLfs", () => {
  it("returns false only after a successful empty listing", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "git-lfs/3.7.0",
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "\n", stderr: "" });

    await expect(inspectGitLfs("C:/tmp/repo.git", run)).resolves.toBe(false);

    expect(run).toHaveBeenNthCalledWith(
      1,
      "git",
      ["lfs", "version"],
      { cwd: "C:/tmp/repo.git", reject: true },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "git",
      ["lfs", "ls-files", "--all", "--name-only"],
      { cwd: "C:/tmp/repo.git", reject: true },
    );
  });

  it("returns true when the successful listing contains an object", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "git-lfs/3.7.0",
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: "fixtures/archive.bin\n",
        stderr: "",
      });

    await expect(inspectGitLfs("/tmp/repo.git", run)).resolves.toBe(true);
  });

  it("raises an actionable error when Git LFS is unavailable", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("git: 'lfs' is not a command"));

    await expect(inspectGitLfs("/tmp/repo.git", run)).rejects.toMatchObject({
      code: "GIT_LFS_UNAVAILABLE",
      hint: expect.stringMatching(/install Git LFS/i),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("raises an actionable error when object inspection fails", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "git-lfs/3.7.0",
        stderr: "",
      })
      .mockRejectedValueOnce(new Error("corrupt pointer"));

    await expect(inspectGitLfs("/tmp/repo.git", run)).rejects.toMatchObject({
      code: "GIT_LFS_INSPECTION_FAILED",
      hint: expect.stringMatching(/no refs or LFS objects were pushed/i),
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify the current re-export cannot satisfy them**

Run:

```bash
npm test -- tests/git/lfs.test.ts
```

Expected: FAIL because `src/git/lfs.ts` does not export `inspectGitLfs`.

- [ ] **Step 3: Implement fail-closed inspection**

Replace `src/git/lfs.ts` with:

```ts
import type { Options } from "execa";

import { ForkNeoError } from "../utils/errors.js";

type CommandResult = { stdout: string; stderr: string };

export type LfsCommandRunner = (
  file: string,
  args: string[],
  options: Options,
) => Promise<CommandResult>;

export async function inspectGitLfs(
  directory: string,
  run: LfsCommandRunner,
): Promise<boolean> {
  try {
    await run("git", ["lfs", "version"], {
      cwd: directory,
      reject: true,
    });
  } catch (error) {
    throw new ForkNeoError(
      "GIT_LFS_UNAVAILABLE",
      "Git LFS is required to inspect a source mirror safely.",
      "Install Git LFS, run `git lfs version`, then retry. The target repository exists, but no refs or LFS objects were pushed.",
      { cause: error },
    );
  }

  let listing: CommandResult;
  try {
    listing = await run(
      "git",
      ["lfs", "ls-files", "--all", "--name-only"],
      { cwd: directory, reject: true },
    );
  } catch (error) {
    throw new ForkNeoError(
      "GIT_LFS_INSPECTION_FAILED",
      "Git LFS could not inspect all objects in the source mirror.",
      "Repair the mirror or Git LFS installation, then retry. The target repository exists, but no refs or LFS objects were pushed.",
      { cause: error },
    );
  }

  return listing.stdout.trim().length > 0;
}
```

- [ ] **Step 4: Run the Git LFS tests**

Run:

```bash
npm test -- tests/git/lfs.test.ts
```

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit the focused Git LFS inspector**

After separate staging and commit authorization:

```bash
git add src/git/lfs.ts tests/git/lfs.test.ts
git diff --cached --check
git commit -m "feat: add fail-closed Git LFS inspection"
```

Expected: one commit containing only the focused helper and tests.

### Task 2: Enforce the Pre-Push Failure Boundary

**Files:**

- Modify: `src/git/mirror.ts`
- Modify: `tests/git/mirror.test.ts`
- Modify: `tests/commands/convert.test.ts`

**Interfaces:**

- Consumes: `inspectGitLfs(directory, run)` from Task 1.
- Produces:
  - `ShellGitService.hasLfs(directory: string): Promise<boolean>` that never converts command failure into `false`.
  - Conversion orchestration evidence that `pushMirror`, `fetchAllLfs`, and `pushAllLfs` remain untouched after inspection failure.

- [ ] **Step 1: Add a conversion regression test for the failure boundary**

Add this import to `tests/commands/convert.test.ts`:

```ts
import { ForkNeoError } from "../../src/utils/errors.js";
```

Add this test inside `describe("runConvert", ...)`:

```ts
it("stops before every push when Git LFS inspection fails", async () => {
  const source = repository();
  const target = repository({
    name: "project-neo",
    fullName: "alex/project-neo",
    isFork: false,
    cloneUrl: "https://github.com/alex/project-neo.git",
    htmlUrl: "https://github.com/alex/project-neo",
  });
  const github = {
    getRepository: vi.fn().mockResolvedValue(source),
    getCurrentUser: vi.fn().mockResolvedValue("alex"),
    repositoryExists: vi.fn().mockResolvedValue(false),
    createRepository: vi.fn().mockResolvedValue(target),
  };
  const git = {
    cloneMirror: vi.fn(),
    pruneUnsupportedRefs: vi.fn(),
    hasLfs: vi.fn().mockRejectedValue(
      new ForkNeoError(
        "GIT_LFS_INSPECTION_FAILED",
        "Git LFS could not inspect all objects in the source mirror.",
        "The target repository exists, but no refs or LFS objects were pushed.",
      ),
    ),
    fetchAllLfs: vi.fn(),
    pushMirror: vi.fn(),
    pushAllLfs: vi.fn(),
  };

  await expect(
    runConvert(
      "alex/project",
      { yes: true },
      {
        github,
        git,
        token: "secret",
        confirm: vi.fn(),
        withTemp: async (work: (directory: string) => Promise<unknown>) =>
          work("C:/tmp/work"),
      } as never,
    ),
  ).rejects.toMatchObject({ code: "GIT_LFS_INSPECTION_FAILED" });

  expect(git.cloneMirror).toHaveBeenCalled();
  expect(git.pruneUnsupportedRefs).toHaveBeenCalled();
  expect(git.fetchAllLfs).not.toHaveBeenCalled();
  expect(git.pushMirror).not.toHaveBeenCalled();
  expect(git.pushAllLfs).not.toHaveBeenCalled();
});
```

In `tests/git/mirror.test.ts`, replace the current LFS detection setup with:

```ts
it("checks Git LFS availability before listing source objects", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({
      stdout: "git-lfs/3.7.0",
      stderr: "",
    })
    .mockResolvedValueOnce({
      stdout: "fixtures/archive.bin\n",
      stderr: "",
    });
  const git = new ShellGitService(run);

  await expect(git.hasLfs("C:/tmp/repo.git")).resolves.toBe(true);

  expect(run.mock.calls.map(([, args]) => args)).toEqual([
    ["lfs", "version"],
    ["lfs", "ls-files", "--all", "--name-only"],
  ]);
});
```

- [ ] **Step 2: Run the focused tests and observe the swallowed error**

Run:

```bash
npm test -- tests/git/lfs.test.ts tests/git/mirror.test.ts tests/commands/convert.test.ts
```

Expected: the new conversion test may already pass because its mock rejects directly, but the mirror test FAILS because `hasLfs` does not run `git lfs version` and still swallows runner failures.

- [ ] **Step 3: Delegate `hasLfs` to the fail-closed inspector**

Add this import to `src/git/mirror.ts`:

```ts
import { inspectGitLfs } from "./lfs.js";
```

Replace `hasLfs` with:

```ts
async hasLfs(directory: string): Promise<boolean> {
  return inspectGitLfs(directory, this.run);
}
```

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npm test -- tests/git/lfs.test.ts tests/git/mirror.test.ts tests/commands/convert.test.ts
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

Expected: all tests PASS; type checking, build, and CLI smoke test exit 0.

- [ ] **Step 5: Prove the production ordering remains pre-push**

Run:

```bash
nl -ba src/commands/convert.ts | sed -n '70,130p'
rg -n "hasLfs|fetchAllLfs|pushMirror|pushAllLfs" src/commands/convert.ts
git diff --check
```

Expected: the observed order is `hasLfs`, conditional `fetchAllLfs`, `pushMirror`, conditional `pushAllLfs`; no push appears before inspection.

- [ ] **Step 6: Commit the orchestration regression**

After separate staging and commit authorization:

```bash
git add src/git/mirror.ts tests/git/mirror.test.ts tests/commands/convert.test.ts
git diff --cached --check
git commit -m "fix: stop conversion when LFS inspection fails"
```

Expected: one commit containing the delegate and the pre-push regression evidence.

### Task 3: Git LFS Requirements and Recovery Documentation

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: fail-closed behavior from Tasks 1 and 2.
- Produces: requirements and recovery guidance that distinguish a created empty target from a pushed target.

- [ ] **Step 1: Update requirements and conversion behavior**

Replace the Git LFS requirement bullet with:

```markdown
- Git LFS for every `forkneo convert` operation; ForkNeo verifies the executable before deciding whether the source contains LFS objects
```

Replace the conversion-process LFS step with:

```markdown
6. Verifies Git LFS is available, inspects the complete mirror, and migrates every LFS object when present
```

After the conversion process, add:

```markdown
If Git LFS is missing or source-object inspection fails, conversion stops before
the mirror push. The newly created target repository remains empty so that
ForkNeo does not perform destructive cleanup. Install or repair Git LFS, verify
`git lfs version`, then retry with a new target name or inspect the retained
target before deciding whether to delete it.
```

- [ ] **Step 2: Add a non-destructive recovery check to manual acceptance**

Under `## Manual Acceptance Test`, add:

```markdown
Before testing a successful migration, temporarily run the built CLI in an
environment where `git lfs version` fails. Confirm that ForkNeo reports
that Git LFS is required, that the target contains no pushed refs, and that
the target is retained for an explicit recovery or deletion decision.
```

- [ ] **Step 3: Run final delivery-unit verification**

Run:

```bash
rg -n "every.*convert|stops before|retained|Git LFS is required" README.md
git diff --check
npm test
npm run typecheck
npm run build
node dist/index.js --help
git status --short
```

Expected: documentation searches find the exact new behavior; all automated checks exit 0; only intended files are modified.

- [ ] **Step 4: Commit the documentation**

After separate staging and commit authorization:

```bash
git add README.md
git diff --cached --check
git commit -m "docs: require Git LFS for safe conversion"
```

Expected: one documentation-only commit.

- [ ] **Step 5: Prepare a truthful pull request**

Use this verification section only after observing every result:

```markdown
## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- `node dist/index.js --help`
- mocked missing Git LFS: typed failure
- mocked inspection failure: typed failure
- inspected call order: no mirror or LFS push before successful inspection

## Recovery boundary

The target repository has already been created when LFS inspection runs, but no
refs or LFS objects have been pushed. ForkNeo retains the target and performs no
automatic deletion.
```

After separate push and pull-request authorizations, open one pull request owned by `alexliluz`. If `ASEnough` independently reproduces the failure or contributes a test, link that evidence and preserve its actual authorship; otherwise do not manufacture collaboration metadata.
