# ForkNeo CI and v0.2.0 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a stable cross-platform merge gate and produce a traceable, independently tested ForkNeo v0.2.0 release.

**Architecture:** Package and CLI versions share a tested constant, while an immutable-action GitHub workflow validates the committed lockfile on nine operating-system/runtime combinations and exposes one stable `CI` gate. Release notes and an authorized disposable fixture define acceptance evidence before an annotated tag and GitHub Release are created.

**Tech Stack:** Node.js 22/24/26, npm, TypeScript 5.9, Vitest 4, tsup 8, GitHub Actions, GitHub rulesets, GitHub Releases.

## Global Constraints

- Set the package engine requirement to Node.js `>=22`.
- Test Ubuntu, macOS, and Windows with Node.js 22, 24, and 26.
- Every matrix job must run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, and `node dist/index.js --help`.
- Use the committed `package-lock.json`; do not generate a second package-manager lockfile.
- Use `actions/checkout` v7.0.1 commit `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- Use `actions/setup-node` v7.0.0 commit `820762786026740c76f36085b0efc47a31fe5020`.
- Give the workflow read-only repository contents permission and no secrets.
- Require the stable `CI` status check only after its name and successful run are visible on the repository.
- Publish v0.2.0 only after all unit tests, type checks, builds, smoke tests, matrix jobs, acceptance checks, and genuine review are complete.
- Git LFS is required for `convert`; Node.js 20 is unsupported.
- Never expose a token in acceptance evidence.
- Never delete a disposable repository or local fixture without separate destructive-action authorization.

---

## File Map

- Create `src/version.ts`: single CLI version constant.
- Create `tests/version.test.ts`: prove package, lockfile, CLI constant, and engine metadata agree.
- Modify `src/cli.ts`: use the shared v0.2.0 constant.
- Modify `package.json`: set version 0.2.0 and Node.js `>=22`.
- Modify `package-lock.json`: synchronize root package version and engine through npm.
- Create `.github/workflows/ci.yml`: nine validation jobs and one stable `CI` aggregation gate.
- Modify `README.md`: update runtime/LFS requirements, CI support policy, and recovery guidance.
- Create `docs/releases/v0.2.0.md`: user-facing release notes and compatibility impact.
- External, separately authorized state: tracking issue, implementation branch, push, pull request, review, ruleset, merge, acceptance repositories, tag, GitHub Release, and later cleanup.

## Current Official Baseline

- GitHub's official `actions/checkout` repository identifies v7.0.1 as the current release and resolves it to commit `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- GitHub's official `actions/setup-node` repository identifies v7.0.0 as the current release and resolves it to commit `820762786026740c76f36085b0efc47a31fe5020`.
- Node.js lists v22 and v24 as LTS, v26 as Current, and v20 as end-of-life as of 2026-07-30.
- Recheck these official sources before implementation if execution occurs on another date:
  - <https://github.com/actions/checkout/releases>
  - <https://github.com/actions/setup-node/releases>
  - <https://nodejs.org/en/about/previous-releases>

## Execution Prerequisites

- Start after credential transport, Git LFS fail-closed, and exact-ref verification pull requests are merged.
- Create `chore/ci-v0.2.0` from the current protected default branch only after branch creation is authorized.
- Use a complete Node.js 24 environment with npm for local release checks; run `npm ci` from the committed lockfile before editing generated metadata.
- Confirm GitHub CLI authentication is `alexliluz` before any external mutation.
- Read existing repository rulesets, branch protection, open issues, open pull requests, tags, and releases before creating external state.

### Task 1: Synchronize Runtime and Release Version

**Files:**

- Create: `src/version.ts`
- Create: `tests/version.test.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: package metadata and the CLI program.
- Produces:
  - `VERSION = "0.2.0"` from `src/version.ts`.
  - package and lockfile root version `0.2.0`.
  - package and lockfile engine requirement `>=22`.
  - CLI `--version` output `0.2.0`.

- [ ] **Step 1: Write the metadata-consistency tests**

Create `tests/version.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run the test and verify all three old metadata paths fail**

Run:

```bash
npm test -- tests/version.test.ts
```

Expected: FAIL because `src/version.ts` is absent and package, lockfile, and CLI still report 0.1.0 with Node.js `>=20`.

- [ ] **Step 3: Add the shared CLI version**

Create `src/version.ts` with:

```ts
export const VERSION = "0.2.0";
```

Add this import to `src/cli.ts`:

```ts
import { VERSION } from "./version.js";
```

Replace the hard-coded Commander version call with:

```ts
.version(VERSION)
```

- [ ] **Step 4: Synchronize package and lockfile metadata through npm**

Run:

```bash
npm pkg set version=0.2.0
npm pkg set engines.node='>=22'
npm install --package-lock-only --ignore-scripts
```

Expected: `package.json` and the root records in `package-lock.json` report version 0.2.0 and engine `>=22`; dependency versions do not change.

- [ ] **Step 5: Verify metadata without relying only on tests**

Run:

```bash
npm test -- tests/version.test.ts
npm pkg get version engines
git diff -- package.json package-lock.json src/version.ts src/cli.ts tests/version.test.ts
```

Expected: tests PASS; npm prints version `0.2.0` and engine `>=22`; the lockfile diff is limited to root package version/engine metadata.

- [ ] **Step 6: Run the full local gate**

Run:

```bash
npm test
npm run typecheck
npm run build
node dist/index.js --version
node dist/index.js --help
```

Expected: all tests PASS; type checking and build exit 0; version prints `0.2.0`; help lists all commands.

- [ ] **Step 7: Commit synchronized release metadata**

After separate staging and commit authorization:

```bash
git add package.json package-lock.json src/version.ts src/cli.ts tests/version.test.ts
git diff --cached --check
git commit -m "chore: prepare ForkNeo v0.2.0 metadata"
```

Expected: one commit with version/engine metadata and the consistency test.

### Task 2: Cross-Platform CI and Stable Merge Gate

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: npm scripts and committed lockfile.
- Produces:
  - Nine `Validate (<os>, Node <version>)` matrix checks.
  - One stable required-check candidate named `CI`.

- [ ] **Step 1: Create the least-privilege CI workflow**

Create `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches:
      - main
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    name: Validate (${{ matrix.os }}, Node ${{ matrix.node }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os:
          - ubuntu-latest
          - macos-latest
          - windows-latest
        node:
          - 22
          - 24
          - 26
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: Set up Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: ${{ matrix.node }}
          cache: npm
          cache-dependency-path: package-lock.json
      - name: Install locked dependencies
        run: npm ci
      - name: Run unit tests
        run: npm test
      - name: Run type checking
        run: npm run typecheck
      - name: Build CLI
        run: npm run build
      - name: Smoke-test built CLI
        run: node dist/index.js --help

  ci:
    name: CI
    if: ${{ always() }}
    needs:
      - validate
    runs-on: ubuntu-latest
    steps:
      - name: Require every matrix job
        run: test '${{ needs.validate.result }}' = 'success'
```

- [ ] **Step 2: Validate workflow structure locally**

Run:

```bash
rg -n "permissions:|contents: read|ubuntu-latest|macos-latest|windows-latest|node:|npm ci|npm test|typecheck|build|dist/index.js --help|name: CI" .github/workflows/ci.yml
git diff --check
```

Expected: all three operating systems, all three Node majors, all five required commands, least-privilege permissions, and the stable `CI` job are present.

- [ ] **Step 3: Run the same command sequence locally**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

Expected: every command exits 0 with the committed lockfile.

- [ ] **Step 4: Commit the workflow**

After separate staging and commit authorization:

```bash
git add .github/workflows/ci.yml
git diff --cached --check
git commit -m "ci: validate supported platforms and Node versions"
```

Expected: one workflow-only commit.

### Task 3: Runtime Policy and v0.2.0 Release Notes

**Files:**

- Modify: `README.md`
- Create: `docs/releases/v0.2.0.md`

**Interfaces:**

- Consumes: all behavior merged for v0.2.0.
- Produces: accurate compatibility, security, reliability, verification, and recovery guidance.

- [ ] **Step 1: Update README runtime and CI policy**

Replace the Node requirement with:

```markdown
- Node.js 22 or newer; CI covers Node.js 22, 24, and 26 on Ubuntu, macOS, and Windows
```

Under `## Development`, after the command block, add:

```markdown
Pull requests must pass the complete `CI` matrix. The stable `CI` aggregate
check succeeds only when every operating-system and Node.js matrix job passes.
The workflow uses the committed npm lockfile and does not receive repository
secrets.
```

Under `## Safety Notes`, add:

```markdown
- v0.2.0 no longer supports Node.js 20 because that release line is end-of-life.
- A failed conversion never triggers automatic deletion of an already-created target; inspect it before taking a separately authorized cleanup action.
```

- [ ] **Step 2: Create complete release notes**

Create `docs/releases/v0.2.0.md` with:

```markdown
# ForkNeo v0.2.0

ForkNeo v0.2.0 hardens repository conversion around credentials, Git LFS, and
ref verification, and adds a cross-platform merge gate.

## Security

- Git and Git LFS receive authentication through child-only, repository-scoped
  runtime configuration.
- Repository URLs and command arguments remain credential-free.
- Surfaced Git failures redact raw, URL-encoded, Basic, and complete
  authorization-header forms.
- Authenticated Git paths reject non-HTTPS and credentialed URLs.

## Reliability

- `convert` verifies Git LFS availability before source-object inspection.
- A missing or failing Git LFS installation stops conversion before the mirror
  push instead of being treated as an empty LFS listing.
- Targets created before a later failure are retained for explicit recovery;
  ForkNeo does not perform destructive cleanup.

## Verification

- Source and target default branches must match.
- Every `refs/heads/*` and `refs/tags/*` ref must exist at the same ref-object
  SHA, including annotated tag objects.
- Diagnostics cover missing, unexpected, and mismatched refs in deterministic
  ref-name order.
- Successful reports record the total number of exactly verified refs.

## Compatibility

- The minimum supported runtime is Node.js 22.
- CI covers Node.js 22, 24, and 26 on Ubuntu, macOS, and Windows.
- Git LFS is required for every `forkneo convert` operation, including sources
  that are ultimately found not to contain LFS objects.
- `scan` and GitHub-API-only `verify` remain usable without Git LFS.

## Upgrade Notes

Install Node.js 22 or newer and Git LFS before upgrading. Run
`git lfs version`, then rebuild ForkNeo from the committed lockfile. If an
earlier conversion left a target repository after failure, inspect its refs and
LFS objects before retrying or deleting it.
```

- [ ] **Step 3: Verify release claims against code and tests**

Run:

```bash
rg -n "GIT_CONFIG_COUNT|GIT_TERMINAL_PROMPT|UNSUPPORTED_GIT_TRANSPORT" src tests
rg -n "GIT_LFS_UNAVAILABLE|GIT_LFS_INSPECTION_FAILED|lfs.*version" src tests
rg -n "listMatchingRefs|Ref object differs|refCount" src tests
rg -n "node.*>=22|\"version\": \"0.2.0\"" package.json package-lock.json
rg -n 'Node.js 22|Git LFS|automatic deletion|complete `CI` matrix' README.md docs/releases/v0.2.0.md
git diff --check
npm test
npm run typecheck
npm run build
node dist/index.js --version
node dist/index.js --help
```

Expected: every release-note claim has a corresponding implementation or test; all gates exit 0; CLI version is 0.2.0.

- [ ] **Step 4: Commit runtime policy and release notes**

After separate staging and commit authorization:

```bash
git add README.md docs/releases/v0.2.0.md
git diff --cached --check
git commit -m "docs: publish ForkNeo v0.2.0 release notes"
```

Expected: one documentation-only commit.

### Task 4: GitHub Pull Request, CI Gate, and Genuine Review

**Files:**

- External GitHub issue, pull request, Actions runs, review, and repository ruleset.

**Interfaces:**

- Consumes: the branch commits from Tasks 1–3.
- Produces: one meaningful release-readiness pull request, a successful nine-cell matrix, a stable `CI` check, and an enforceable default-branch quality gate.

- [ ] **Step 1: Open a real release-readiness issue**

After separate issue-creation authorization, create an issue owned by `alexliluz` with:

```markdown
## Problem

ForkNeo has no automated cross-platform merge gate, reports Node.js 20 as
supported after that runtime reached end-of-life, and duplicates its package
and CLI version.

## Acceptance criteria

- package, lockfile, and CLI report v0.2.0
- minimum runtime is Node.js 22
- Ubuntu, macOS, and Windows pass on Node.js 22, 24, and 26
- every job runs install, tests, type checking, build, and built-CLI help
- one stable `CI` check can protect the default branch
- release notes document security, LFS, ref-verification, compatibility, and
  recovery changes
```

Expected: the issue describes a genuine release-engineering gap and is not an activity-only work item.

- [ ] **Step 2: Push and open the release-readiness pull request**

After separate push and pull-request authorizations, push `chore/ci-v0.2.0` and open a pull request owned by `alexliluz` that links the release-readiness issue and includes:

```markdown
## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- `node dist/index.js --version`
- `node dist/index.js --help`
- package-lock diff limited to root version and engine metadata

## CI

- Ubuntu: Node.js 22, 24, 26
- macOS: Node.js 22, 24, 26
- Windows: Node.js 22, 24, 26
- stable aggregate check: `CI`

## External state

- no release or tag created
- no repository rule changed
- no disposable acceptance repository created
```

Expected: the pull request contains only release metadata, workflow, policy documentation, and release notes.

- [ ] **Step 3: Wait for and inspect every matrix result**

Run:

```bash
gh pr checks --repo alexliluz/ForkNeo --watch
gh pr view --repo alexliluz/ForkNeo --json statusCheckRollup,reviews,reviewDecision,mergeStateStatus
```

Expected: nine `Validate` jobs and the `CI` aggregate succeed. Investigate and fix any failure on technical merit; do not retry until green without understanding the failure.

- [ ] **Step 4: Obtain genuine independent review**

Ask `ASEnough` to:

1. inspect the workflow permissions and immutable action pins;
2. check the Node matrix and stable aggregation logic;
3. compare release-note claims with merged behavior;
4. submit findings or approval only after completing that inspection.

Expected: the review records work actually performed. Resolve every finding before merge; do not fabricate or prearrange approval.

- [ ] **Step 5: Create the default-branch ruleset only after the `CI` check exists**

First run the read-only check:

```bash
gh api repos/alexliluz/ForkNeo/rulesets
```

If no equivalent default-branch rule exists, write `.tmp/main-quality-gate.json` with:

```json
{
  "name": "main quality gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "exclude": [],
      "include": ["~DEFAULT_BRANCH"]
    }
  },
  "rules": [
    {
      "type": "deletion"
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "pull_request",
      "parameters": {
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_approving_review_count": 1,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": true,
        "required_status_checks": [
          {
            "context": "CI"
          }
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
```

After separate repository-setting authorization, run:

```bash
gh api --method POST repos/alexliluz/ForkNeo/rulesets --input .tmp/main-quality-gate.json
```

Expected: the default branch rejects deletion and force-pushes, requires one non-stale approval with resolved threads, and requires the latest `CI` result. If GitHub rejects or normalizes a field, stop and inspect the returned schema rather than weakening the gate.

- [ ] **Step 6: Merge only through the protected pull request**

After CI, review, and merge authorization:

```bash
gh pr view --repo alexliluz/ForkNeo --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
```

Expected before merge: mergeable, approved, and all required checks successful. Merge using the repository's chosen history policy; do not bypass the ruleset.

### Task 5: Authorized Acceptance and GitHub Release

**Files:**

- External fixture repositories, acceptance evidence, annotated tag, and GitHub Release.

**Interfaces:**

- Consumes: the merged v0.2.0 release candidate.
- Produces: independently observed migration evidence, traceable tag `v0.2.0`, and GitHub Release `v0.2.0`.

- [ ] **Step 1: Establish explicit acceptance fixtures**

Use these repository roles only after each external mutation is authorized:

- `ASEnough/forkneo-acceptance-fixture`: a public test fixture with `main`, `release-candidate`, annotated tag `v1.0.0-fixture`, and one Git LFS-tracked file.
- `alexliluz/forkneo-acceptance-fixture`: the actual GitHub fork used as the conversion source.
- `alexliluz/forkneo-acceptance-fixture-neo`: the independent target created by ForkNeo.

The fixture README must explain its acceptance-test purpose.
`fixtures/lfs-payload.txt` must be tracked by Git LFS and contain exactly
`ForkNeo v0.2.0 Git LFS acceptance fixture.` followed by one newline. Commits,
branches, tags, and the LFS file must support the stated test cases; do not add
unrelated activity.

- [ ] **Step 2: Run the local release gate from the merged commit**

Run:

```bash
npm ci
npm test
npm run typecheck
npm run build
node dist/index.js --version
node dist/index.js --help
git status --short
```

Expected: every command exits 0, version is 0.2.0, and the working tree is clean.

- [ ] **Step 3: Inspect credential persistence in a controlled local mirror**

With `GITHUB_TOKEN` present only in the process environment, run:

```bash
mkdir -p .tmp
test ! -e .tmp/forkneo-auth-inspection.git
npm exec tsx -- --eval '
import { ShellGitService } from "./src/git/mirror.ts";
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");
await new ShellGitService().cloneMirror(
  "https://github.com/alexliluz/forkneo-acceptance-fixture.git",
  ".tmp/forkneo-auth-inspection.git",
  token,
);
'
git -C .tmp/forkneo-auth-inspection.git remote get-url origin
```

Expected: the remote URL is exactly `https://github.com/alexliluz/forkneo-acceptance-fixture.git` and contains no username, token, or authorization value. Retain `.tmp/forkneo-auth-inspection.git` until its separate cleanup authorization.

- [ ] **Step 4: Run conversion and exact verification**

Run:

```bash
node dist/index.js convert alexliluz/forkneo-acceptance-fixture --name forkneo-acceptance-fixture-neo
node dist/index.js verify alexliluz/forkneo-acceptance-fixture-neo --source alexliluz/forkneo-acceptance-fixture
git -C .tmp/forkneo-auth-inspection.git lfs ls-files --all --name-only
test ! -e .tmp/forkneo-target-checkout
git clone https://github.com/alexliluz/forkneo-acceptance-fixture-neo.git .tmp/forkneo-target-checkout
git -C .tmp/forkneo-target-checkout lfs pull
test "$(cat .tmp/forkneo-target-checkout/fixtures/lfs-payload.txt)" = \
  "ForkNeo v0.2.0 Git LFS acceptance fixture."
```

Expected: conversion succeeds, verification reports matching default branch and exact ref count, the source mirror LFS listing includes `fixtures/lfs-payload.txt`, and the independent target clone resolves the LFS pointer to the exact fixture content. Retain both `.tmp` directories until their separate cleanup authorization.

- [ ] **Step 5: Record sanitized acceptance evidence**

Add one pull-request or release-tracking-issue comment owned by the account that performed the checks. It must contain:

- exact source and target repository names;
- merged commit SHA;
- Node, npm, Git, and Git LFS versions;
- the five local gate commands and exit results;
- nine GitHub Actions matrix results plus aggregate `CI`;
- source and target default branch;
- sorted source and target ref/SHA maps;
- LFS object identifier and successful target checkout result;
- the credential-free temporary remote URL;
- retained fixture and local `.tmp` cleanup status;
- confirmation that no token or authorization value is present.

Expected: every entry is copied from observed, sanitized output. Do not infer or invent results.

- [ ] **Step 6: Create and push the annotated release tag**

After separate tag-creation authorization:

```bash
git tag -a v0.2.0 -m "ForkNeo v0.2.0"
git show --no-patch --decorate v0.2.0
```

Expected: the annotated tag points to the reviewed merged release commit.

After separate tag-push authorization:

```bash
git push origin refs/tags/v0.2.0
```

Expected: GitHub shows the same tag object and target commit.

- [ ] **Step 7: Publish the GitHub Release**

After separate release-creation authorization:

```bash
gh release create v0.2.0 \
  --repo alexliluz/ForkNeo \
  --verify-tag \
  --title "ForkNeo v0.2.0" \
  --notes-file docs/releases/v0.2.0.md
```

Expected: one public GitHub Release owned by `alexliluz`, linked to the existing annotated tag and the reviewed merge commit.

- [ ] **Step 8: Verify release and achievement-relevant facts without assuming an award**

Run:

```bash
gh release view v0.2.0 --repo alexliluz/ForkNeo --json name,tagName,isDraft,isPrerelease,publishedAt,url,targetCommitish
gh pr list --repo alexliluz/ForkNeo --state merged --json number,title,author,mergedAt,url
gh issue list --repo alexliluz/ForkNeo --state all --json number,title,author,state,url
git status --short --branch
```

Expected: the release is public, final, and traceable; contribution records reflect real authors and work; the local tree is clean. Check the `alexliluz` profile separately after GitHub processes activity, but do not claim an Achievement until the profile displays it.

- [ ] **Step 9: Clean up only after destructive-action authorization**

List all fixture repositories and `.tmp` paths first. Delete only the exact targets the user authorizes. Record what was removed, whether GitHub recovery is available, and whether any public acceptance evidence still references the removed fixture.
