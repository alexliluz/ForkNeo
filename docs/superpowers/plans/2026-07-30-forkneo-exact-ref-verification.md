# ForkNeo Exact Ref Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that every source branch and tag ref exists at the target with the exact same ref-object SHA and that both repositories select the same default branch.

**Architecture:** Repository state becomes a deterministic `refs/* -> object SHA` map plus the selected default branch. The GitHub adapter reads complete head and tag collections from the Git refs API, a pure comparison utility emits ref-sorted diagnostics, and convert/verify/report surfaces consume the same model.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Octokit REST 22, Vitest 4, GitHub Git refs API.

## Global Constraints

- Use Node.js `>=22`.
- Retrieve complete `refs/heads/*` and `refs/tags/*` collections through the Git refs API.
- Preserve each ref object's SHA, including the annotated-tag ref object's SHA; do not dereference a tag to its commit.
- Compare missing refs, unexpected refs, mismatched object SHAs, and the selected default branch.
- Sort ref findings lexicographically by full ref name for deterministic output.
- Treat one difference as verification failure.
- Record the verified ref count instead of separate branch and tag counts in successful migration reports.
- Continue rejecting a target whose GitHub repository metadata has `fork === true`.
- Do not broaden this release into GitHub issues, pull requests, releases, settings, or other platform metadata migration.

---

## File Map

- Modify `src/utils/verify.ts`: define exact repository state and deterministic comparison.
- Modify `tests/utils/verify.test.ts`: test equality and every difference category.
- Modify `src/types/index.ts`: update `GitHubService.getRepositoryState` to the new model and signature.
- Modify `src/github/repos.ts`: fetch repository metadata and complete Git ref collections.
- Modify `tests/github/repos.test.ts`: prove heads/tags pagination and annotated-tag SHA preservation.
- Modify `src/commands/verify.ts`: report default branch and verified ref count.
- Modify `tests/commands/verify.test.ts`: exercise exact equality and mismatched ref failure.
- Modify `src/commands/convert.ts`: compare exact state and write `refCount`.
- Modify `tests/commands/convert.test.ts`: use exact state fixtures and assert report data.
- Modify `src/utils/report.ts`: replace branch/tag counts with verified ref count.
- Modify `tests/utils/report.test.ts`: lock the new report output.
- Modify `src/cli.ts`: summarize default branch and ref count.
- Modify `tests/cli.test.ts`: assert the verify output contract.
- Modify `README.md`: document exact ref-object parity and report semantics.

## Execution Prerequisites

- Start after credential transport and Git LFS fail-closed pull requests are merged.
- Create `feat/exact-ref-verification` from the current protected default branch only after branch creation is authorized.
- Use Node.js 22 or newer with npm and run `npm ci` from the committed lockfile.
- No live GitHub repository is needed for unit tests; later acceptance must use explicitly authorized repositories.

### Task 0: Record the Weak-Verification Defect

**Files:**

- External GitHub issue.

**Interfaces:**

- Consumes: v0.1.0 verification that compares only the default-branch commit and branch/tag name sets.
- Produces: one genuine data-preservation issue owned by `alexliluz`.

- [ ] **Step 1: Check for an equivalent issue**

Run:

```bash
gh issue list \
  --repo alexliluz/ForkNeo \
  --state all \
  --search '"exact ref" verification in:title,body' \
  --json number,title,state,url
```

Expected: no existing issue already requires exact branch and tag ref-object parity. Reuse an equivalent issue instead of creating a duplicate.

- [ ] **Step 2: Create the verification issue**

After separate issue-creation authorization, run:

```bash
gh issue create \
  --repo alexliluz/ForkNeo \
  --title "Verification: compare exact branch and tag ref objects" \
  --body '## Problem

ForkNeo v0.1.0 verifies the latest default-branch commit and branch/tag names.
Two repositories can pass those checks while a non-default branch or tag points
to a different object.

## Required behavior

- read complete `refs/heads/*` and `refs/tags/*` collections
- preserve annotated-tag ref-object SHAs
- compare default branch, missing refs, unexpected refs, and mismatched SHAs
- sort diagnostics by full ref name
- fail on one difference
- report the total number of exactly verified refs

## Verification

Pure comparison tests and mocked GitHub adapter tests must cover every mismatch
category without changing a live repository.'
```

Expected: one data-preservation issue authored by `alexliluz`.

### Task 1: Exact Repository-State Domain Model

**Files:**

- Modify: `tests/utils/verify.test.ts`
- Modify: `src/utils/verify.ts`

**Interfaces:**

- Consumes: source and target `RepositoryState` values.
- Produces:
  - `RepositoryState` with `defaultBranch: string` and `refs: Readonly<Record<string, string>>`.
  - `RepositoryComparison` with `matches: boolean` and `differences: string[]`.
  - `compareRepositoryState(source, target): RepositoryComparison`.

- [ ] **Step 1: Replace name-set tests with exact ref-map tests**

Replace `tests/utils/verify.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import { compareRepositoryState } from "../../src/utils/verify.js";

describe("compareRepositoryState", () => {
  it("accepts the same default branch and exact ref-object map", () => {
    expect(
      compareRepositoryState(
        {
          defaultBranch: "main",
          refs: {
            "refs/heads/main": "aaa",
            "refs/heads/release": "bbb",
            "refs/tags/v1": "tag-object",
          },
        },
        {
          defaultBranch: "main",
          refs: {
            "refs/tags/v1": "tag-object",
            "refs/heads/release": "bbb",
            "refs/heads/main": "aaa",
          },
        },
      ),
    ).toEqual({ matches: true, differences: [] });
  });

  it("reports default, missing, unexpected, and mismatched refs deterministically", () => {
    const result = compareRepositoryState(
      {
        defaultBranch: "main",
        refs: {
          "refs/heads/main": "aaa",
          "refs/heads/release": "bbb",
          "refs/tags/v1": "tag-source",
        },
      },
      {
        defaultBranch: "trunk",
        refs: {
          "refs/heads/extra": "ccc",
          "refs/heads/main": "aaa",
          "refs/tags/v1": "tag-target",
        },
      },
    );

    expect(result).toEqual({
      matches: false,
      differences: [
        "Default branch differs: source main, target trunk",
        "Unexpected target ref refs/heads/extra -> ccc",
        "Missing target ref refs/heads/release -> bbb",
        "Ref object differs for refs/tags/v1: source tag-source, target tag-target",
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test and verify the old model fails**

Run:

```bash
npm test -- tests/utils/verify.test.ts
```

Expected: FAIL because the current implementation expects `latestCommit`, `branches`, and `tags`.

- [ ] **Step 3: Implement deterministic exact comparison**

Replace `src/utils/verify.ts` with:

```ts
export interface RepositoryState {
  defaultBranch: string;
  refs: Readonly<Record<string, string>>;
}

export interface RepositoryComparison {
  matches: boolean;
  differences: string[];
}

export function compareRepositoryState(
  source: RepositoryState,
  target: RepositoryState,
): RepositoryComparison {
  const differences: string[] = [];

  if (source.defaultBranch !== target.defaultBranch) {
    differences.push(
      `Default branch differs: source ${source.defaultBranch}, target ${target.defaultBranch}`,
    );
  }

  const refNames = [...new Set([
    ...Object.keys(source.refs),
    ...Object.keys(target.refs),
  ])].sort();

  for (const refName of refNames) {
    const sourceSha = source.refs[refName];
    const targetSha = target.refs[refName];

    if (sourceSha === undefined && targetSha !== undefined) {
      differences.push(`Unexpected target ref ${refName} -> ${targetSha}`);
      continue;
    }
    if (sourceSha !== undefined && targetSha === undefined) {
      differences.push(`Missing target ref ${refName} -> ${sourceSha}`);
      continue;
    }
    if (sourceSha !== targetSha) {
      differences.push(
        `Ref object differs for ${refName}: source ${sourceSha}, target ${targetSha}`,
      );
    }
  }

  return {
    matches: differences.length === 0,
    differences,
  };
}
```

- [ ] **Step 4: Run the pure comparison test**

Run:

```bash
npm test -- tests/utils/verify.test.ts
```

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the domain-model change**

After separate staging and commit authorization:

```bash
git add src/utils/verify.ts tests/utils/verify.test.ts
git diff --cached --check
git commit -m "feat: compare exact repository refs"
```

Expected: one pure, independently reviewable domain commit.

### Task 2: Complete Git Ref Collection

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src/github/repos.ts`
- Modify: `tests/github/repos.test.ts`

**Interfaces:**

- Consumes: `RepositoryReference`.
- Produces:
  - `GitHubService.getRepositoryState(reference: RepositoryReference): Promise<RepositoryState>`.
  - A state map built from `octokit.rest.git.listMatchingRefs` for `heads/` and `tags/`.
  - Default branch read from current repository metadata.

- [ ] **Step 1: Replace the adapter state test**

Replace the existing `"loads a repository state for verification"` test in `tests/github/repos.test.ts` with:

```ts
it("loads exact head and tag object SHAs for verification", async () => {
  const octokit = {
    paginate: vi
      .fn()
      .mockResolvedValueOnce([
        { ref: "refs/heads/main", object: { sha: "commit-main" } },
        { ref: "refs/heads/release", object: { sha: "commit-release" } },
      ])
      .mockResolvedValueOnce([
        { ref: "refs/tags/v1", object: { sha: "annotated-tag-object" } },
      ]),
    rest: {
      repos: {
        get: vi.fn().mockResolvedValue({
          data: { default_branch: "main" },
        }),
      },
      git: {
        listMatchingRefs: vi.fn(),
      },
    },
  };
  const service = new GitHubRepositoryService(octokit as never);

  await expect(
    service.getRepositoryState({
      owner: "alex",
      repo: "project",
      fullName: "alex/project",
    }),
  ).resolves.toEqual({
    defaultBranch: "main",
    refs: {
      "refs/heads/main": "commit-main",
      "refs/heads/release": "commit-release",
      "refs/tags/v1": "annotated-tag-object",
    },
  });

  expect(octokit.paginate).toHaveBeenNthCalledWith(
    1,
    octokit.rest.git.listMatchingRefs,
    {
      owner: "alex",
      repo: "project",
      ref: "heads/",
      per_page: 100,
    },
  );
  expect(octokit.paginate).toHaveBeenNthCalledWith(
    2,
    octokit.rest.git.listMatchingRefs,
    {
      owner: "alex",
      repo: "project",
      ref: "tags/",
      per_page: 100,
    },
  );
});
```

- [ ] **Step 2: Run the adapter test and observe old branch/tag-list behavior**

Run:

```bash
npm test -- tests/github/repos.test.ts
```

Expected: FAIL because `getRepositoryState` still requires a default-branch argument and calls repository branch/tag list endpoints.

- [ ] **Step 3: Update the service contract**

In `src/types/index.ts`, replace `GitHubService.getRepositoryState` with:

```ts
getRepositoryState(
  reference: RepositoryReference,
): Promise<RepositoryState>;
```

- [ ] **Step 4: Implement complete Git ref collection**

In `src/github/repos.ts`, add this interface after `ApiRepository`:

```ts
interface ApiGitRef {
  ref: string;
  object: { sha: string };
}
```

Replace `getRepositoryState` with:

```ts
async getRepositoryState(
  reference: RepositoryReference,
): Promise<RepositoryState> {
  const [repository, heads, tags] = await Promise.all([
    this.octokit.rest.repos.get({
      owner: reference.owner,
      repo: reference.repo,
    }),
    this.octokit.paginate(this.octokit.rest.git.listMatchingRefs, {
      owner: reference.owner,
      repo: reference.repo,
      ref: "heads/",
      per_page: 100,
    }),
    this.octokit.paginate(this.octokit.rest.git.listMatchingRefs, {
      owner: reference.owner,
      repo: reference.repo,
      ref: "tags/",
      per_page: 100,
    }),
  ]);

  const refs = Object.fromEntries(
    ([...heads, ...tags] as ApiGitRef[])
      .map(({ ref, object }) => [ref, object.sha] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    defaultBranch: repository.data.default_branch,
    refs,
  };
}
```

- [ ] **Step 5: Run adapter, type, and full tests to identify remaining callers**

Run:

```bash
npm test -- tests/github/repos.test.ts
npm run typecheck
```

Expected: repository adapter tests PASS. Type checking FAILS only at command callers and fixtures that still pass a default branch or construct the old state shape; Task 3 resolves those intentional integration failures.

- [ ] **Step 6: Commit the GitHub adapter**

After separate staging and commit authorization:

```bash
git add src/types/index.ts src/github/repos.ts tests/github/repos.test.ts
git diff --cached --check
git commit -m "feat: load exact GitHub ref objects"
```

Expected: one adapter commit that preserves annotated tag object SHAs.

### Task 3: Integrate Exact State into Verify, Convert, Reports, and CLI

**Files:**

- Modify: `src/commands/verify.ts`
- Modify: `tests/commands/verify.test.ts`
- Modify: `src/commands/convert.ts`
- Modify: `tests/commands/convert.test.ts`
- Modify: `src/utils/report.ts`
- Modify: `tests/utils/report.test.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**

- Consumes: exact `RepositoryState` and `GitHubService.getRepositoryState(reference)` from Tasks 1 and 2.
- Produces:
  - `VerifyResult` with `verified`, `target`, `defaultBranch`, and `refCount`.
  - `MigrationReportData.refCount`.
  - CLI success output that reports default branch and verified ref count.

- [ ] **Step 1: Replace verify command fixtures and expectations**

Replace `tests/commands/verify.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import { runVerify } from "../../src/commands/verify.js";

const target = {
  owner: "alex",
  name: "project-neo",
  fullName: "alex/project-neo",
  isFork: false,
  defaultBranch: "main",
};

const matchingState = {
  defaultBranch: "main",
  refs: {
    "refs/heads/main": "abc",
    "refs/tags/v1": "tag-object",
  },
};

describe("runVerify", () => {
  it("accepts an independent repository and reports exact ref count", async () => {
    const github = {
      getRepository: vi.fn().mockResolvedValue(target),
      getRepositoryState: vi.fn().mockResolvedValue(matchingState),
    };

    await expect(
      runVerify("alex/project-neo", {}, { github } as never),
    ).resolves.toEqual({
      verified: true,
      target: "alex/project-neo",
      defaultBranch: "main",
      refCount: 2,
    });
  });

  it("rejects a repository that is still a fork", async () => {
    const github = {
      getRepository: vi.fn().mockResolvedValue({ ...target, isFork: true }),
    };

    await expect(
      runVerify("alex/project-neo", {}, { github } as never),
    ).rejects.toMatchObject({ code: "TARGET_IS_FORK" });
  });

  it("rejects one mismatched ref object", async () => {
    const github = {
      getRepository: vi
        .fn()
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce({
          ...target,
          fullName: "alex/project",
          isFork: true,
        }),
      getRepositoryState: vi
        .fn()
        .mockResolvedValueOnce({
          ...matchingState,
          refs: {
            ...matchingState.refs,
            "refs/tags/v1": "target-tag-object",
          },
        })
        .mockResolvedValueOnce(matchingState),
    };

    await expect(
      runVerify(
        "alex/project-neo",
        { source: "alex/project" },
        { github } as never,
      ),
    ).rejects.toMatchObject({
      code: "VERIFICATION_FAILED",
      message: expect.stringContaining("Ref object differs for refs/tags/v1"),
    });
  });
});
```

- [ ] **Step 2: Update convert and report regression fixtures**

In `tests/commands/convert.test.ts`, replace the successful state fixture with:

```ts
const state = {
  defaultBranch: "main",
  refs: {
    "refs/heads/main": "abc",
    "refs/heads/release": "def",
    "refs/tags/v1": "tag-object",
  },
};
```

Replace the report assertion with:

```ts
expect(writeReport).toHaveBeenCalledWith(
  expect.objectContaining({
    verified: true,
    refCount: 3,
  }),
);
```

In `tests/utils/report.test.ts`, replace `branchCount` and `tagCount` input fields with:

```ts
refCount: 5,
```

Add:

```ts
expect(report).toContain("Verified refs | 5");
expect(report).not.toContain("Branches |");
expect(report).not.toContain("Tags |");
```

- [ ] **Step 3: Run the integration tests and observe old result/report shapes**

Run:

```bash
npm test -- tests/commands/verify.test.ts tests/commands/convert.test.ts tests/utils/report.test.ts tests/cli.test.ts
```

Expected: FAIL because callers still use the old state signature, verify returns branch/tag/latest-commit fields, and the report lacks `refCount`.

- [ ] **Step 4: Update verify orchestration**

Replace `VerifyResult` and `runVerify` in `src/commands/verify.ts` with:

```ts
export interface VerifyResult {
  verified: true;
  target: string;
  defaultBranch: string;
  refCount: number;
}

export async function runVerify(
  targetValue: string,
  options: VerifyOptions,
  dependencies: VerifyDependencies,
): Promise<VerifyResult> {
  const targetReference = parseRepository(targetValue);
  const target = await dependencies.github.getRepository(targetReference);
  if (target.isFork) {
    throw new ForkNeoError(
      "TARGET_IS_FORK",
      `${target.fullName} is still a GitHub fork.`,
      "Verify the independent target repository rather than the original fork.",
    );
  }

  const targetState = await dependencies.github.getRepositoryState(
    targetReference,
  );

  if (options.source) {
    const sourceReference = parseRepository(options.source);
    await dependencies.github.getRepository(sourceReference);
    const sourceState = await dependencies.github.getRepositoryState(
      sourceReference,
    );
    const comparison = compareRepositoryState(sourceState, targetState);
    if (!comparison.matches) {
      throw new ForkNeoError(
        "VERIFICATION_FAILED",
        `Verification failed for ${target.fullName}:\n${comparison.differences.join("\n")}`,
        "Inspect the mismatched refs and rerun the mirror push before verifying again.",
      );
    }
  }

  return {
    verified: true,
    target: target.fullName,
    defaultBranch: targetState.defaultBranch,
    refCount: Object.keys(targetState.refs).length,
  };
}
```

- [ ] **Step 5: Update conversion and migration report data**

In `src/commands/convert.ts`, replace state loading with:

```ts
const [sourceState, targetState] = await Promise.all([
  dependencies.github.getRepositoryState(sourceReference),
  dependencies.github.getRepositoryState(targetReference),
]);
```

Replace the report count fields with:

```ts
refCount: Object.keys(targetState.refs).length,
```

In `src/utils/report.ts`, replace the two count fields in `MigrationReportData` with:

```ts
refCount: number;
```

Replace the branch/tag table rows with:

```ts
| Verified refs | ${data.refCount} |
```

- [ ] **Step 6: Update CLI success output**

In `src/cli.ts`, replace the `verify` success message with:

```ts
dependencies.write(
  chalk.green(
    `Verified ${result.target}: default branch ${result.defaultBranch}, ${result.refCount} refs`,
  ),
);
```

Add this test to the `createProgram` describe block in `tests/cli.test.ts`:

```ts
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
```

- [ ] **Step 7: Run focused and full verification**

Run:

```bash
npm test -- tests/utils/verify.test.ts tests/github/repos.test.ts tests/commands/verify.test.ts tests/commands/convert.test.ts tests/utils/report.test.ts tests/cli.test.ts
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

Expected: all tests PASS; TypeScript, build, and smoke test exit 0.

- [ ] **Step 8: Inspect for remnants of the weak model**

Run:

```bash
rg -n "latestCommit|branches: string\\[\\]|tags: string\\[\\]|branchCount|tagCount|listBranches|listTags|getCommit" src tests
git diff --check
git status --short
```

Expected: no source or test code uses the old verification model or endpoints; only intended files are modified.

- [ ] **Step 9: Commit the integration**

After separate staging and commit authorization:

```bash
git add src/commands/verify.ts tests/commands/verify.test.ts src/commands/convert.ts tests/commands/convert.test.ts src/utils/report.ts tests/utils/report.test.ts src/cli.ts tests/cli.test.ts
git diff --cached --check
git commit -m "feat: verify exact ref object parity"
```

Expected: one integration commit with commands, report, CLI, and tests.

### Task 4: Exact-Verification Documentation and Review Evidence

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: implemented exact-ref behavior from Tasks 1–3.
- Produces: precise user-facing verification and report semantics.

- [ ] **Step 1: Replace weak verification wording**

Replace the `--source` verification paragraph with:

```markdown
With `--source`, verification compares the selected default branch and every
`refs/heads/*` and `refs/tags/*` ref-object SHA. It reports missing, unexpected,
and mismatched refs in ref-name order. A single difference returns a non-zero
exit code.
```

Replace the output count bullets with:

```markdown
- Selected default branch
- Number of exactly verified branch and tag refs
```

Replace the conversion-process verification step with:

```markdown
9. Verifies the selected default branch and exact object SHA of every branch and tag ref
```

- [ ] **Step 2: Run final delivery-unit checks**

Run:

```bash
rg -n "ref-object SHA|missing, unexpected|exact object SHA|exactly verified" README.md
git diff --check
npm test
npm run typecheck
npm run build
node dist/index.js --help
git status --short
```

Expected: all searches find the new contract; every automated command exits 0.

- [ ] **Step 3: Commit the documentation**

After separate staging and commit authorization:

```bash
git add README.md
git diff --cached --check
git commit -m "docs: define exact ref verification"
```

Expected: one documentation-only commit.

- [ ] **Step 4: Prepare truthful pull-request evidence**

Use this verification section only after observing every result:

```markdown
## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- `node dist/index.js --help`
- annotated tag fixture preserves the ref object's SHA
- comparison fixtures cover missing, unexpected, and mismatched refs
- diagnostics are sorted by full ref name
- successful reports contain one verified ref count

## Boundaries

- target independence remains a prerequisite
- GitHub platform metadata is outside this change
- no live repository was changed by unit tests
```

After separate push and pull-request authorizations, open one pull request owned by `alexliluz`. Ask `ASEnough` to review only after it can independently inspect the Git refs API mapping and test evidence; do not prearrange approval.
