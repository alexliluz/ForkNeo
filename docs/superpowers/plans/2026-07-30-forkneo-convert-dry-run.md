# ForkNeo Convert Dry-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a genuinely read-only `forkneo convert --dry-run` preflight and prevent normal preflight failures from leaving empty target repositories.

**Architecture:** `runConvert` will return a discriminated dry-run or converted result and share one temporary-mirror preflight path between both modes. Dry-run stops after source-state, mirror, ref-pruning, and LFS inspection checks; normal conversion additionally fetches source LFS objects before creating and mutating the target. The CLI renders mode-specific output, and phase-aware errors distinguish preflight from post-creation recovery.

**Tech Stack:** TypeScript 5.9, Node.js 22+, Commander 15, Vitest 4, tsup 8, Octokit 22, Git and Git LFS.

## Global Constraints

- Dry-run mode must make no GitHub write, Git push, LFS fetch or push, confirmation, or migration-report call.
- Dry-run mode reports source, proposed target, default branch, exact source ref count, LFS detection, and `Remote changes: none`.
- Normal conversion must complete clone, unsupported-ref pruning, LFS availability and inspection, and any source LFS fetch before calling `createRepository`.
- Existing targets are never deleted automatically.
- Credential-free repository URLs and child-only Git authentication remain unchanged.
- Node.js support remains `>=22`; do not add dependencies.
- `alexliluz` owns the implementation, branch, PR, merge, and release.
- `ASEnough` contributes real regression tests and boundary analysis.
- The shared feature commit is authored by `alexliluz` and contains the exact co-author trailer for `ASEnough`.
- Repository CI, review rules, and security gates must not be bypassed.

## File Structure

- Modify `tests/commands/convert.test.ts`: shared regression tests for dry-run non-mutation and target-creation ordering.
- Modify `src/commands/convert.ts`: result union, shared preflight, remote-creation boundary, and phase-aware errors.
- Modify `tests/git/lfs.test.ts`: pre-creation-safe LFS recovery wording.
- Modify `src/git/lfs.ts`: remove the obsolete claim that a target already exists during LFS inspection failure.
- Modify `tests/cli.test.ts`: option registration and mode-specific output tests.
- Modify `src/cli.ts`: register `--dry-run`, choose status text, and render the result union.
- Modify `README.md`: document dry-run usage, reordered conversion stages, and failure boundaries.
- Create no production modules and add no dependencies.

---

### Task 1: Record the engineering problem and genuine test contribution

**Files:**
- Read: `docs/superpowers/specs/2026-07-30-forkneo-convert-dry-run-design.md`
- Modify in collaboration worktree: `tests/commands/convert.test.ts`
- Remote record: one `alexliluz/ForkNeo` issue

**Interfaces:**
- Consumes: `runConvert(sourceValue, options, dependencies)` from `src/commands/convert.ts`.
- Produces: a failing ASEnough-authored regression-test commit and an issue that describes independently useful safety work.

- [ ] **Step 1: Create the issue as `alexliluz`**

Create one issue titled `Add a read-only convert preflight` with this body:

```markdown
## Problem

`forkneo convert` creates the target repository before cloning and inspecting
the source mirror. Clone, unsupported-ref, or Git LFS preflight failures can
therefore leave an empty target.

Users also cannot validate a proposed source and target without starting a
conversion.

## Proposed behavior

- Add `convert --dry-run`.
- Validate the source fork and target availability.
- Clone and prune a temporary mirror.
- Verify Git LFS and detect pointers.
- Report the default branch and exact source ref count.
- Make no remote writes, LFS download, confirmation, or report.
- In normal mode, finish source-side preflight before creating the target.

## Acceptance criteria

- Tests prove every mutating dependency is untouched in dry-run mode.
- Tests prove clone/LFS preflight failures do not call `createRepository`.
- CLI, documentation, full CI, and a public fixture dry run are included.

Design: `docs/superpowers/specs/2026-07-30-forkneo-convert-dry-run-design.md`
```

Record the returned issue URL in the execution log.

- [ ] **Step 2: Create an isolated collaboration worktree**

From the repository root, create `collab/ase-convert-dry-run-tests` from
`82b60a2` in `.worktrees/collab-ase-convert-dry-run-tests`. Verify `.worktrees`
is ignored first. Configure only that worktree with:

```text
user.name = ASEnough
user.email = 295963714+ASEnough@users.noreply.github.com
```

- [ ] **Step 3: Add the failing dry-run non-mutation test**

In `tests/commands/convert.test.ts`, add a test with a three-ref source state,
`hasLfs` resolving `true`, and spies for every dependency. Its essential
assertions are:

```ts
const result = await runConvert(
  "alex/project",
  { dryRun: true },
  dependencies as never,
);

expect(result).toEqual({
  mode: "dry-run",
  source: "alex/project",
  target: "alex/project-neo",
  defaultBranch: "main",
  refCount: 3,
  lfsDetected: true,
});
expect(git.cloneMirror).toHaveBeenCalledWith(
  source.cloneUrl,
  expect.any(String),
  "secret",
);
expect(git.pruneUnsupportedRefs).toHaveBeenCalled();
expect(git.hasLfs).toHaveBeenCalled();
expect(dependencies.confirm).not.toHaveBeenCalled();
expect(git.fetchAllLfs).not.toHaveBeenCalled();
expect(github.createRepository).not.toHaveBeenCalled();
expect(git.pushMirror).not.toHaveBeenCalled();
expect(git.pushAllLfs).not.toHaveBeenCalled();
expect(github.setDefaultBranch).not.toHaveBeenCalled();
expect(dependencies.writeReport).not.toHaveBeenCalled();
```

The test fixture must provide `getRepositoryState` and must not make
`createRepository` succeed silently; an accidental call should fail the test.

- [ ] **Step 4: Strengthen the existing LFS-inspection failure test**

Update the existing `stops before every push when Git LFS inspection fails`
test to assert:

```ts
expect(github.createRepository).not.toHaveBeenCalled();
expect(git.cloneMirror).toHaveBeenCalled();
expect(git.pruneUnsupportedRefs).toHaveBeenCalled();
expect(git.fetchAllLfs).not.toHaveBeenCalled();
expect(git.pushMirror).not.toHaveBeenCalled();
expect(git.pushAllLfs).not.toHaveBeenCalled();
```

Change the test's `ForkNeoError` hint fixture so it says no target repository
was created.

- [ ] **Step 5: Add an unexpected preflight-failure test**

Make `cloneMirror` reject with `new Error("clone unavailable")` and assert:

```ts
await expect(runConvert("alex/project", { yes: true }, dependencies as never))
  .rejects.toMatchObject({
    code: "CONVERSION_PREFLIGHT_FAILED",
    message: expect.stringContaining(
      "before creating alex/project-neo",
    ),
    hint: expect.stringMatching(/no target repository was created/i),
  });
expect(github.createRepository).not.toHaveBeenCalled();
```

- [ ] **Step 6: Run the focused tests and verify RED**

Run:

```text
npm test -- tests/commands/convert.test.ts
```

Expected: the dry-run result test fails because current code prompts or
creates the target, and the strengthened LFS test fails because current code
calls `createRepository` before inspection.

- [ ] **Step 7: Commit the genuine test contribution as `ASEnough`**

Commit only `tests/commands/convert.test.ts` with:

```text
test: specify read-only convert preflight
```

Verify the commit author and committer email, record its SHA, and leave the
collaboration branch available until the shared feature commit is verified.

---

### Task 2: Implement the shared preflight and phase boundary

**Files:**
- Modify: `src/commands/convert.ts`
- Integrate: `tests/commands/convert.test.ts`

**Interfaces:**
- Consumes: the Task 1 failing tests and existing `GitHubService`,
  `GitService`, `withTempDirectory`, and report contracts.
- Produces:

```ts
export interface DryRunResult {
  mode: "dry-run";
  source: string;
  target: string;
  defaultBranch: string;
  refCount: number;
  lfsDetected: boolean;
}

export interface ConvertedResult {
  mode: "converted";
  source: string;
  target: string;
  reportPath: string;
  lfsMigrated: boolean;
}

export type ConvertResult = DryRunResult | ConvertedResult;
```

- [ ] **Step 1: Integrate the ASEnough test commit without preserving it as a separate feature-branch commit**

In `feat/convert-dry-run`, apply the recorded collaboration commit with
`git cherry-pick --no-commit <sha>`. Confirm that only the intended test file
is staged, then unstage it so the complete implementation can be reviewed
together before the atomic shared commit.

- [ ] **Step 2: Add the result union and option**

In `src/commands/convert.ts`:

```ts
export interface ConvertOptions {
  name?: string;
  suffix?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export interface DryRunResult {
  mode: "dry-run";
  source: string;
  target: string;
  defaultBranch: string;
  refCount: number;
  lfsDetected: boolean;
}

export interface ConvertedResult {
  mode: "converted";
  source: string;
  target: string;
  reportPath: string;
  lfsMigrated: boolean;
}

export type ConvertResult = DryRunResult | ConvertedResult;
```

Change `runConvert` to return `Promise<ConvertResult>`.

- [ ] **Step 3: Keep validation before confirmation and local work**

Retain the existing source parsing, fork validation, current-user lookup,
target-name construction, and target-exists check. Run confirmation only when:

```ts
if (!options.dryRun && !options.yes) {
  // existing confirmation and cancellation behavior
}
```

Initialize injected utilities before the shared `try` block:

```ts
const useTemp = dependencies.withTemp ?? withTempDirectory;
const saveReport = dependencies.writeReport ?? writeMigrationReport;
const now = dependencies.now ?? (() => new Date());
let target: Awaited<ReturnType<GitHubService["createRepository"]>> | undefined;
let creationAttempted = false;
```

- [ ] **Step 4: Build one temporary-mirror preflight**

Before entering `useTemp`, read exact source state only for dry-run mode:

```ts
const dryRunSourceState = options.dryRun
  ? await dependencies.github.getRepositoryState(sourceReference)
  : undefined;
```

Inside `useTemp`, perform these operations in order:

```ts
const mirrorDirectory = path.join(directory, `${targetName}.git`);
await dependencies.git.cloneMirror(
  source.cloneUrl,
  mirrorDirectory,
  dependencies.token,
);
await dependencies.git.pruneUnsupportedRefs(mirrorDirectory);
const lfsDetected = await dependencies.git.hasLfs(mirrorDirectory);
```

For dry-run mode, return immediately from the already-read exact state:

```ts
if (options.dryRun) {
  return {
    mode: "dry-run",
    source: source.fullName,
    target: targetReference.fullName,
    defaultBranch: dryRunSourceState!.defaultBranch,
    refCount: Object.keys(dryRunSourceState!.refs).length,
    lfsDetected,
  };
}
```

Do not call `fetchAllLfs` in this branch.

- [ ] **Step 5: Delay target creation in normal mode**

Continue the same temporary callback with:

```ts
if (lfsDetected) {
  await dependencies.git.fetchAllLfs(
    mirrorDirectory,
    source.cloneUrl,
    dependencies.token,
  );
}

creationAttempted = true;
target = await dependencies.github.createRepository({
  name: targetName,
  description: source.description ?? undefined,
  isPrivate: source.isPrivate,
});
```

Only after the target resolves, run the existing mirror push, optional LFS
push, default-branch update, exact source/target comparison, and report.
Return:

```ts
return {
  mode: "converted",
  source: source.fullName,
  target: target.fullName,
  reportPath,
  lfsMigrated: lfsDetected,
};
```

- [ ] **Step 6: Add accurate phase-aware unexpected errors**

Preserve a typed `ForkNeoError` when it already describes the failed stage.
For an unexpected error before any creation attempt, throw:

```ts
throw new ForkNeoError(
  "CONVERSION_PREFLIGHT_FAILED",
  `Conversion preflight failed before creating ${targetReference.fullName}.`,
  "Review the cause, fix the source or local tooling, then retry. No target repository was created.",
  { cause: error },
);
```

If `creationAttempted` is true but `target` is still undefined, use a
creation-uncertainty error that tells the user to inspect
`targetReference.fullName` before retrying because the API request may have
completed remotely.

If `target` exists, retain:

```ts
throw new ForkNeoError(
  "CONVERSION_FAILED",
  `Conversion failed after creating ${target.fullName}. The remote repository was kept.`,
  "Review the error, fix the cause, then retry with a new target name or complete the mirror push manually.",
  { cause: error },
);
```

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

```text
npm test -- tests/commands/convert.test.ts
npm run typecheck
```

Expected: all convert tests pass and TypeScript exits 0.

---

### Task 3: Make LFS failures truthful before target creation

**Files:**
- Modify: `tests/git/lfs.test.ts`
- Modify: `src/git/lfs.ts`

**Interfaces:**
- Consumes: `inspectGitLfs(directory, run): Promise<boolean>`.
- Produces: unchanged error codes with recovery hints that do not claim a
  remote target exists.

- [ ] **Step 1: Update the LFS failure assertions**

For both unavailable and inspection-failed tests, require hints to contain:

```ts
hint: expect.stringMatching(/no target repository was created/i)
```

The unavailable test must still mention installing Git LFS, and the
inspection-failed test must still mention repairing Git LFS or the mirror.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```text
npm test -- tests/git/lfs.test.ts
```

Expected: both failure-hint assertions fail because the current text says the
target exists.

- [ ] **Step 3: Update the two recovery hints**

In `src/git/lfs.ts`, use:

```text
Install Git LFS, run `git lfs version`, then retry. No target repository was created.
```

and:

```text
Repair the mirror or Git LFS installation, then retry. No target repository was created.
```

Do not change the error codes, primary messages, command order, or causes.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```text
npm test -- tests/git/lfs.test.ts tests/commands/convert.test.ts
```

Expected: both test files pass.

---

### Task 4: Expose and document the dry-run CLI

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ConvertResult` from Task 2.
- Produces: Commander option `--dry-run` and mode-specific terminal output.

- [ ] **Step 1: Add CLI option and output tests**

Add one registration assertion:

```ts
expect(convert?.options.map((option) => option.long))
  .toContain("--dry-run");
```

Add a dry-run parse test using mocked repository, state, and Git services.
After:

```ts
await program.parseAsync([
  "node",
  "forkneo",
  "convert",
  "alex/project",
  "--name",
  "project-independent",
  "--dry-run",
]);
```

assert that output contains:

```text
Dry run passed: alex/project -> alex/project-independent
Default branch: main
Refs: 3
Git LFS: detected
Remote changes: none
```

and assert no output contains `Converted` or `Report:`.

- [ ] **Step 2: Run the CLI test and verify RED**

Run:

```text
npm test -- tests/cli.test.ts
```

Expected: Commander rejects `--dry-run` or the output assertions fail.

- [ ] **Step 3: Register the option and render the union**

In the `convert` command chain add:

```ts
.option("--dry-run", "validate conversion without remote changes")
```

Use:

```ts
const result = await withStatus(
  options.dryRun ? "Checking conversion" : "Migrating repository",
  () => runConvert(repository, options, dependencies),
);
```

For `result.mode === "dry-run"`, write exactly the five approved lines, with
`detected` or `not detected` derived from `result.lfsDetected`, then return
from the action. Keep the two existing converted output lines for
`result.mode === "converted"`.

- [ ] **Step 4: Run CLI and command tests and verify GREEN**

Run:

```text
npm test -- tests/cli.test.ts tests/commands/convert.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 5: Document the public behavior**

In `README.md`:

- add a dry-run example immediately after the custom-name example;
- state that dry-run clones and inspects a temporary mirror but performs no
  confirmation, LFS bulk download, GitHub mutation, push, or report write;
- reorder the normal conversion process so target creation follows clone,
  pruning, LFS inspection, and required source LFS fetch;
- replace the obsolete empty-target LFS guidance with the no-target-created
  preflight boundary;
- retain the post-creation recovery and no-automatic-deletion warning.

- [ ] **Step 6: Inspect the built help**

Run:

```text
npm run build
node dist/index.js convert --help
```

Expected: build succeeds and help contains
`--dry-run  validate conversion without remote changes`.

---

### Task 5: Verify and create the atomic shared commit

**Files:**
- All files from Tasks 1-4

**Interfaces:**
- Consumes: the complete green implementation and recorded ASEnough test SHA.
- Produces: one truthful co-authored feature commit on
  `feat/convert-dry-run`.

- [ ] **Step 1: Run the complete local gate**

Run with the locked npm dependencies:

```text
npm test
npm run typecheck
npm run build
node dist/index.js --help
node dist/index.js convert --help
git diff --check
```

Expected: 0 failing tests, both TypeScript/build commands succeed, both help
commands exit 0, and no whitespace error is reported.

- [ ] **Step 2: Audit the diff against the design**

Verify:

- no dependency or lockfile change;
- no remote mutation is reachable from the dry-run branch;
- `fetchAllLfs` precedes `createRepository` in normal mode;
- every new public behavior has a regression test;
- README failure claims match actual phase behavior;
- credentials, fixture tokens, and local paths are absent from the diff.

- [ ] **Step 3: Verify contributor identities**

Confirm the feature worktree identity is:

```text
alexliluz <49665315+alexliluz@users.noreply.github.com>
```

Confirm the recorded test commit identity is:

```text
ASEnough <295963714+ASEnough@users.noreply.github.com>
```

- [ ] **Step 4: Create the shared commit**

Stage only the intended source, test, and README files. Commit as
`alexliluz` with:

```text
feat: add read-only convert preflight

Co-authored-by: ASEnough <295963714+ASEnough@users.noreply.github.com>
```

- [ ] **Step 5: Verify the commit object**

Inspect `git cat-file -p HEAD` and require:

- author and committer are the `alexliluz` noreply identity;
- exactly one valid `Co-authored-by` trailer appears after a blank line;
- the trailer uses the `ASEnough` noreply identity;
- the commit contains the independently authored tests from Task 1.

---

### Task 6: Public fixture acceptance without remote mutation

**Files:**
- Read: built `dist/index.js`
- Remote reads: source and proposed target repository metadata
- PR evidence: acceptance comment

**Interfaces:**
- Consumes: built feature commit and the authorized
  `alexliluz/forkneo-acceptance-fixture` public fork.
- Produces: evidence that one real dry run leaves no target repository.

- [ ] **Step 1: Choose and verify a unique proposed target**

Use a descriptive name such as
`forkneo-dry-run-acceptance-20260730`. Confirm through GitHub that it does not
exist before the run. If it exists, increment a numeric suffix rather than
deleting or reusing it.

- [ ] **Step 2: Run the built CLI**

Authenticate as `alexliluz` and run:

```text
node dist/index.js convert alexliluz/forkneo-acceptance-fixture \
  --name <verified-unique-name> \
  --dry-run
```

Expected: the approved dry-run output, `Remote changes: none`, and exit 0.
Redact tokens and credential-derived values from any recorded diagnostics.

- [ ] **Step 3: Prove the target still does not exist**

Repeat the same GitHub repository read used before the run. Expected: not
found. Retain the before check, CLI output, after check, source, target, commit
SHA, and timestamp without including credentials. Add that evidence to the PR
immediately after Task 7 opens it.

---

### Task 7: Push, review, CI, merge, and attribution audit

**Files:**
- Remote branch: `feat/convert-dry-run`
- Remote PR in `alexliluz/ForkNeo`

**Interfaces:**
- Consumes: design commit, shared feature commit, issue, and acceptance record.
- Produces: a merged PR owned by `alexliluz`, reviewed by `ASEnough`, with the
  co-authored commit preserved on `main`.

- [ ] **Step 1: Push as `alexliluz` and open the PR**

Push `feat/convert-dry-run` and open a PR that links the issue, summarizes the
read-only contract and new creation boundary, and lists the exact local and
public-fixture evidence. Add the retained Task 6 acceptance record as a PR
comment. Use no achievement language in the engineering PR.

- [ ] **Step 2: Verify GitHub recognizes both commit authors**

Open the shared commit through GitHub's commit API/page. Require both
`alexliluz` and `ASEnough` to be associated with it before review or merge.
If attribution is missing, correct only the commit identity/trailer and rerun
the full local gate before force-updating the feature branch.

- [ ] **Step 3: Complete genuine review as `ASEnough`**

Switch GitHub CLI authentication to `ASEnough`. Inspect the final diff,
workflow status, test evidence, mutation call graph, error wording, and public
fixture result. Submit findings if present. Approve only when those checks
support approval.

- [ ] **Step 4: Resolve findings as `alexliluz`**

Switch back to `alexliluz`. Address every technical finding, rerun relevant
tests, and push. Because the ruleset dismisses stale or last-push approvals,
request a fresh ASEnough review after the final push.

- [ ] **Step 5: Wait for the complete CI gate**

Require all 9 OS/Node validation jobs and the aggregate `CI` check to pass.
Do not bypass or administratively override any required check or review.

- [ ] **Step 6: Merge without squashing the co-authored commit**

Use a merge commit so the exact shared commit and its trailer remain reachable
from `main`. Merge as `alexliluz`, then verify the PR is merged and
`origin/main` contains the shared commit object.

- [ ] **Step 7: Audit attribution and achievement state**

Through GitHub:

- verify the merged commit shows both authors;
- verify the PR, issue, merge, and main code contribution belong primarily to
  `alexliluz`;
- check the `alexliluz` profile achievement display after GitHub has processed
  the merge;
- record that display lag or GitHub eligibility decisions are external and
  must not be simulated with extra commits or reviews.

---

### Task 8: Prepare the separate Galaxy Brain support track

**Files:**
- No ForkNeo code changes
- Remote: two unresolved public GitHub Discussions selected after a fresh read

**Interfaces:**
- Consumes: current discussion state, demonstrated Git/LFS experience, and
  official primary documentation.
- Produces: two useful answers posted by `alexliluz`; acceptance remains under
  the control of the original posters or maintainers.

- [ ] **Step 1: Revalidate candidates immediately before drafting**

Exclude discussions that are solved, have an existing sufficient answer, are
primarily opinion requests, require undisclosed system access, or are outside
demonstrated expertise. Start with the previously identified Git LFS
`locksverify` candidate, but re-open it and verify its current status.

- [ ] **Step 2: Research only primary sources**

For each candidate, gather current official documentation and, where needed,
upstream source or maintainer documentation. Distinguish verified facts from
inference and do not include secrets, unsafe commands, or destructive steps.

- [ ] **Step 3: Draft answerable, reproducible guidance**

Each answer must include:

- the likely cause and what evidence supports it;
- safe diagnostic commands;
- a minimal fix with scope and rollback;
- limitations and conditions where the fix should not be used;
- direct links to official sources.

- [ ] **Step 4: Re-open the thread before posting**

Confirm no new accepted or equivalent answer appeared during drafting. If it
did, discard that candidate and select another; do not post a duplicate for
achievement credit.

- [ ] **Step 5: Post as `alexliluz` and respond normally**

Post only the final useful answer. Do not use `ASEnough` to ask, endorse, or
accept it. Answer follow-up technical questions when they arise. Record the
discussion URL and answer URL.

- [ ] **Step 6: Treat acceptance as external**

Check whether the original poster or maintainer accepts the answer over time.
Do not request a sham acceptance, self-accept, or create substitute
discussions. Two accepted answers are the target, but useful unaccepted
answers remain valid support work rather than grounds for manipulation.
