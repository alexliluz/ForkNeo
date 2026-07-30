# ForkNeo Convert Dry-Run Design

- **Status:** Approved
- **Date:** 2026-07-30
- **Primary maintainer:** `alexliluz`

## Context

`forkneo convert` currently creates the target GitHub repository before it
clones and inspects the source mirror. A clone failure, unsupported-ref
cleanup failure, unavailable Git LFS executable, or Git LFS inspection
failure can therefore leave an empty target repository even though ForkNeo
has not pushed any data.

Users also have no way to validate a proposed source and target without
starting a conversion. `--yes` controls confirmation, but it does not provide
a read-only preview.

This design adds a meaningful `--dry-run` mode and moves local and source-side
preflight work ahead of remote repository creation in normal conversions. It
also defines a truthful collaboration boundary for the two contributors who
will implement and review the change.

## Goals

- Let users validate a proposed conversion without mutating GitHub or writing
  a migration report.
- Report the resolved source, proposed target, default branch, exact source
  ref count, and whether Git LFS pointers are detected.
- Guarantee that dry-run mode does not create a repository, push Git or LFS
  data, set a default branch, prompt for destructive confirmation, or write a
  success report.
- Delay target creation in a normal conversion until clone, unsupported-ref
  pruning, Git LFS availability and inspection, and any required source-side
  LFS fetch have succeeded.
- Keep the existing non-destructive recovery policy after a target repository
  has been created.
- Preserve accurate authorship, testing, review, and merge provenance.

## Non-Goals

- Proving that a future GitHub write will succeed. Permissions, repository
  quotas, branch policy, network state, and source state can change after the
  dry run.
- Downloading all source LFS objects during a dry run. That can consume
  substantial bandwidth and storage and is not needed to detect LFS pointers.
- Creating a temporary remote repository and deleting it afterward.
- Automatically deleting a target after a post-creation failure.
- Changing the behavior of `scan` or `verify`.
- Creating commits, pull requests, reviews, issues, or discussions without an
  independent engineering or support purpose.

## Considered Approaches

### 1. Local read-only preflight

The recommended approach combines GitHub read APIs with a temporary local
mirror. It validates authentication, the source fork, target naming and
availability, exact source refs, mirror cloning, unsupported-ref pruning, and
Git LFS inspection. It makes no remote writes.

This provides substantially stronger evidence than API metadata alone while
remaining genuinely dry.

### 2. GitHub API metadata only

An API-only preview is faster, but it cannot detect clone failures, local Git
or Git LFS problems, unsupported-ref cleanup failures, or LFS pointers in the
mirror. It would give users a misleading sense that conversion is ready.

### 3. Temporary remote creation followed by rollback

Creating and deleting a temporary repository would exercise more of the write
path, but it is destructive, requires additional permissions, produces audit
events, and can fail during cleanup. It is not a dry run.

## Command Surface

The existing `convert` command gains a boolean option:

```text
forkneo convert alex/source --name source-independent --dry-run
```

A successful preview prints:

```text
Dry run passed: alex/source -> alex/source-independent
Default branch: main
Refs: 3
Git LFS: detected
Remote changes: none
```

When the mirror has no LFS pointers, the Git LFS line says `not detected`.
The command must not print `Converted` or a report path in dry-run mode.

`--dry-run` takes precedence over `--yes`: dry-run mode never asks for
conversion confirmation because it performs no remote mutation.

## Result Model

`runConvert` returns a discriminated union so callers cannot mistake a
preview for a completed migration:

```ts
interface DryRunResult {
  mode: "dry-run";
  source: string;
  target: string;
  defaultBranch: string;
  refCount: number;
  lfsDetected: boolean;
}

interface ConvertedResult {
  mode: "converted";
  source: string;
  target: string;
  reportPath: string;
  lfsMigrated: boolean;
}

type ConvertResult = DryRunResult | ConvertedResult;
```

The CLI branches on `mode`. A dry-run result has no optional report field and
cannot accidentally flow through the migration-success output.

## Dry-Run Flow

The dry-run path is:

1. Parse the source repository reference.
2. Load the source and require GitHub's fork flag to be true.
3. Resolve and validate the target name under the authenticated account.
4. Require the proposed target repository not to exist.
5. Read the complete source repository state for its default branch and exact
   branch and tag ref count.
6. Create a temporary local workspace.
7. Clone a credential-free mirror using ForkNeo's child-only authentication.
8. Remove unsupported GitHub pull-request refs from the local mirror.
9. Verify that Git LFS is available and inspect all refs for LFS pointers.
10. Remove the temporary workspace in all outcomes.
11. Return the dry-run result without any remote mutation.

The path never calls:

- `createRepository`;
- `pushMirror` or `pushAllLfs`;
- `setDefaultBranch`;
- `fetchAllLfs`;
- the confirmation callback;
- the migration report writer.

Skipping `fetchAllLfs` is deliberate. Dry-run mode proves that Git LFS can
inspect the mirror and reports whether LFS pointers exist; it does not claim
that every remote LFS object can be downloaded later.

## Normal Conversion Ordering

Normal conversion retains explicit confirmation before potentially expensive
clone and LFS work. After confirmation, its order becomes:

1. validate source and target;
2. obtain conversion confirmation unless `--yes` is set;
3. clone the source into a temporary credential-free mirror;
4. prune unsupported refs;
5. verify Git LFS availability and inspect the complete mirror;
6. fetch all source LFS objects when pointers are present;
7. create the target repository;
8. mirror-push Git refs;
9. push LFS objects when present;
10. set the target default branch;
11. compare exact source and target states;
12. write the successful migration report;
13. remove the temporary workspace in all outcomes.

Failures before step 7 must state that no target repository was created.
Failures from step 7 onward preserve the target and retain ForkNeo's existing
manual-recovery guidance. ForkNeo never attempts destructive rollback.

## Error Boundaries

The implementation must distinguish two phases:

- **Preflight failure:** the target does not exist. The error identifies the
  failed local or source-side stage and must not imply that cleanup or a
  remote recovery is needed.
- **Post-creation failure:** the target exists and is kept. The error retains
  the target name and manual-recovery guidance.

Existing typed `ForkNeoError` values remain intact when they already describe
the failed stage accurately. Unexpected errors are wrapped at the appropriate
phase without exposing credentials.

Temporary directory cleanup remains unconditional in dry-run, preflight, and
post-creation outcomes.

## Testing Strategy

### Command orchestration

Tests will prove that:

- dry-run mode returns the resolved source, target, default branch, exact ref
  count, and LFS detection result;
- dry-run mode performs clone, ref pruning, and Git LFS inspection;
- dry-run mode never confirms, fetches LFS objects, creates or mutates a
  repository, pushes data, or writes a report;
- target-exists and non-fork validation still fail before local work;
- a clone, prune, LFS availability, LFS inspection, or source LFS fetch
  failure in normal mode occurs before `createRepository`;
- normal conversion creates the target only after preflight and retains the
  current post-creation recovery behavior;
- temporary workspaces are cleaned by the existing `withTempDirectory`
  contract in successful and failing paths.

### CLI behavior

Tests will prove that:

- `convert --help` documents `--dry-run`;
- dry-run output contains the preview facts and `Remote changes: none`;
- dry-run output contains neither migration-success wording nor a report
  path;
- normal conversion output remains unchanged.

### Regression and acceptance gates

The complete verification gate is:

```text
npm test
npm run typecheck
npm run build
node dist/index.js convert --help
```

The repository's full CI matrix must pass before merge.

One acceptance run will use an authorized public fork fixture and a unique
proposed target name. GitHub read checks must confirm that the target does not
exist both before and after the dry run. The acceptance record will include
the dry-run output and the two nonexistence checks without exposing tokens.

## Collaboration and Provenance

`alexliluz` owns the issue, approved design, implementation architecture, CLI
and documentation changes, feature branch, pull request, merge decision, and
release.

`ASEnough` will make a concrete contribution by independently developing the
regression tests and edge-case matrix for:

- absence of all remote mutations in dry-run mode;
- preflight failures occurring before target creation;
- LFS and target-exists boundaries.

`alexliluz` will integrate that test work with the production implementation
into one atomic feature commit. The commit will use `alexliluz` as the primary
author and include the exact trailer:

```text
Co-authored-by: ASEnough <295963714+ASEnough@users.noreply.github.com>
```

That trailer is included only because the commit contains work actually
performed for the secondary account's assigned test responsibility. GitHub
documents that co-authored commits require a separate trailer after a blank
line and an email associated with the co-author's account:

<https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors>

Before merge, the GitHub commit view must recognize both accounts. `ASEnough`
will inspect the final pushed diff and verification evidence before submitting
a genuine review. Approval is not automatic and technical findings must be
resolved normally. Repository rules and CI remain mandatory.

The primary account receives the core contribution, pull request, merge, and
release attribution. GitHub controls achievement eligibility and display
timing, so the workflow can satisfy the documented co-authorship conditions
but cannot promise when or whether a badge appears.

## Discussions Boundary

Work toward GitHub's Galaxy Brain achievement is a separate support track and
is not part of this feature's implementation or pull request.

ForkNeo Discussions will not be enabled for self-authored questions and
answers. `ASEnough` will not ask, accept, or coordinate answers for
`alexliluz`.

Candidate external discussions must:

- contain a real unresolved technical question;
- be within demonstrated experience and supported by primary documentation;
- have no existing answer that already solves the question;
- receive an answer with diagnostics, limitations, and security guidance;
- leave acceptance entirely to the original poster or repository maintainer.

Immediately before posting, each candidate and draft will be checked again
for new answers or changed status. Posting to repositories outside ForkNeo
requires explicit scope authorization for the named discussions. Two useful
answers can be delivered, but accepted-answer status cannot be manufactured or
guaranteed.

## Success Criteria

The change is complete when:

- dry-run mode provides the approved preview and makes no remote changes;
- normal conversion performs all source-side preflight work before target
  creation;
- preflight and post-creation errors describe the correct recovery boundary;
- unit, CLI, build, type, CI, and public-fixture acceptance checks pass;
- GitHub recognizes both contributors on the genuine shared commit;
- the pull request receives a real review and merges through the repository's
  normal rules with `alexliluz` as the primary owner.
