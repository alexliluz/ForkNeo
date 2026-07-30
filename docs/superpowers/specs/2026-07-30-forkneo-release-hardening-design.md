# ForkNeo Release Hardening Design

- **Status:** Approved direction, written specification pending user review
- **Date:** 2026-07-30
- **Target release:** v0.2.0

## Context

ForkNeo converts a GitHub fork into an independent repository by creating a
new repository, mirroring Git refs, migrating Git LFS objects when present,
and comparing the source and target.

The initial implementation has a useful command surface and unit tests, but
three behaviors can undermine its preservation guarantees:

1. Git credentials are embedded in HTTPS URLs passed to child processes.
   Git may expose those URLs in process arguments and store them in the
   temporary mirror's remote configuration.
2. `git lfs ls-files` failures are treated as "no LFS objects." A missing or
   broken Git LFS installation can therefore let conversion continue without
   migrating required objects.
3. Verification compares the latest default-branch commit and the sets of
   branch and tag names. It does not prove that every source ref points to the
   same object in the target.

The repository also has no continuous-integration workflow, protected merge
gate, or published GitHub release. Node.js 20, the current documented minimum,
is end-of-life as of this design. Node.js 22 and 24 are the supported LTS
lines, while Node.js 26 is the current release line.

## Goals

- Keep authentication secrets out of Git command arguments, repository URLs,
  persisted Git configuration, reports, and user-facing errors.
- Stop conversion when Git LFS availability or inspection cannot be trusted.
- Prove exact branch and tag ref parity after a mirror push.
- Establish automated tests, type checking, builds, and CLI smoke tests on
  supported operating systems and Node.js versions.
- Produce a reproducible v0.2.0 release with documented verification evidence.
- Preserve truthful authorship, testing, and review provenance throughout the
  work.

## Non-Goals

- Migrating GitHub issues, pull requests, discussions, releases, Actions
  history, settings, rulesets, collaborators, secrets, or uploaded assets.
- Deleting a partially created target repository automatically.
- Rewriting source history, licenses, notices, authorship, or provenance.
- Adding GitHub Enterprise Server support in this release.
- Publishing to npm. A separate design is required before introducing package
  registry credentials or a package release workflow.
- Creating work items, commits, pull requests, reviews, or releases solely to
  increase activity counts. Each delivery unit must have an independent
  engineering purpose.

## Design

### 1. Ephemeral Git authentication

ForkNeo will pass ordinary credential-free HTTPS clone URLs to Git. It will
not add a username or token to a URL.

For each authenticated Git or Git LFS child process, ForkNeo will construct a
child-only environment using Git's runtime configuration variables:

- `GIT_CONFIG_COUNT`
- `GIT_CONFIG_KEY_<n>`
- `GIT_CONFIG_VALUE_<n>`

The runtime configuration will provide an `Authorization` header scoped to
the exact HTTPS repository URL. The header value will use GitHub's token-as-
password HTTP authentication format. ForkNeo will also disable terminal
credential prompts so a non-interactive migration fails instead of hanging.

This configuration is inherited by Git LFS subprocesses but is not written to
global, local, or repository Git configuration. The source and target URLs
stored by Git remain credential-free.

The execution adapter will redact all derived secret forms from errors:

- the raw token;
- URL-encoded token text;
- the generated HTTP authorization value.

ForkNeo will reject non-HTTPS transport URLs in this path instead of sending
an HTTP authorization header to an unexpected scheme or host.

Git documents both runtime configuration through environment variables and
the risk of credentials in URLs:

- <https://git-scm.com/docs/git-config#Documentation/git-config.txt-GITCONFIGCOUNT>
- <https://git-scm.com/docs/git-config#Documentation/git-config.txt-transfercredentialsInUrl>

### 2. Fail-closed Git LFS inspection

`convert` will require a functioning Git LFS executable before it decides
whether the source mirror contains LFS objects. This is intentionally stricter
than the initial implementation.

The Git adapter will:

1. run `git lfs version` in the mirror;
2. run `git lfs ls-files --all --name-only`;
3. return `false` only when the command succeeds with no listed objects;
4. return `true` when the command succeeds and lists objects;
5. raise a typed, actionable error for every command failure.

The conversion must stop before the mirror push if LFS availability or object
inspection fails. The error will explain that no target data has been pushed
yet when that statement is true.

When LFS objects exist, the existing fetch-all and push-all stages remain
mandatory. A failure in either stage keeps the target repository for manual
recovery, consistent with ForkNeo's current non-destructive policy.

The v0.2.0 documentation will state that Git LFS is a requirement for
`convert`, even when a repository is eventually found not to use LFS. `scan`
and GitHub-API-only verification remain usable without Git LFS.

GitHub documents that Git repositories contain LFS pointer files while the
corresponding objects are stored separately:

<https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage>

### 3. Exact ref parity

Repository state will represent refs as a deterministic mapping:

```text
refs/heads/main    -> <object SHA>
refs/heads/release -> <object SHA>
refs/tags/v0.1.0   -> <object SHA>
```

The GitHub adapter will retrieve complete `refs/heads/*` and `refs/tags/*`
collections through the Git refs API. It will preserve the ref object's SHA,
including the object SHA of annotated tag refs, rather than reducing refs to
names or dereferenced commits.

Verification will compare:

- missing refs;
- unexpected refs;
- refs present on both sides with different object SHAs;
- the selected default branch;
- target independence (`fork === false`).

Findings will be sorted by ref name for deterministic output and tests. A
single mismatch makes verification fail. The report will record the verified
ref count instead of only separate branch and tag counts.

### 4. Conversion ordering and failure boundaries

The hardened conversion flow is:

1. validate source and target names;
2. confirm the source is a fork and the target does not exist;
3. obtain explicit user confirmation;
4. create the target repository;
5. clone a credential-free mirror using child-only authentication;
6. remove unsupported GitHub pull-request refs;
7. verify Git LFS availability and inspect the complete mirror;
8. fetch all LFS objects when present;
9. mirror-push Git refs;
10. push all LFS objects when present;
11. set the target default branch;
12. read exact source and target ref maps;
13. fail on any parity difference;
14. write a successful migration report;
15. remove the temporary workspace in all outcomes.

Errors will identify the failed stage without printing tokens. If target
creation has already succeeded, ForkNeo will keep the target and provide
manual recovery guidance. It will not perform automatic destructive cleanup.

### 5. Supported runtime and CI

The package engine requirement will move from Node.js `>=20` to `>=22` because
Node.js 20 is end-of-life. This compatibility change is one reason the
hardening release is v0.2.0 rather than v0.1.1.

CI will run on Ubuntu, macOS, and Windows with Node.js 22, 24, and 26. Every
matrix job will use the committed lockfile and run:

```text
npm ci
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

Node.js recommends production use of supported LTS releases and lists the
current lifecycle status here:

<https://nodejs.org/en/about/previous-releases>

The repository merge gate may require the CI check only after the workflow has
completed successfully in the repository and its check name is known.
Enabling branch protection or a ruleset is an external repository-setting
action and is not part of the code change itself.

### 6. Collaboration and provenance

The primary maintainer account, `alexliluz`, owns the design, core
implementation, pull requests, merge decisions, and release.

The secondary account, `ASEnough`, is limited to work it actually performs,
such as:

- reproducing a failure in an independent environment;
- contributing a regression test or documentation derived from that
  reproduction;
- exercising the release candidate against authorized disposable
  repositories;
- reviewing the pull request against recorded evidence.

A commit will name multiple authors only when both accounts contributed to
that commit's content. A review will be submitted only after the reviewer has
inspected the change and run or checked the relevant verification. Review
findings must be resolved on technical merit; an approval is not
pre-arranged.

Disposable repositories used for acceptance testing will have an explicit
purpose and test record. Their later deletion requires a separate,
destructive-action authorization.

## Delivery Units

Implementation should use the smallest number of independently valuable pull
requests. The expected units are:

1. **Credential transport hardening** — remove credentialed URLs and add
   redaction/regression tests.
2. **LFS fail-closed behavior** — distinguish a successful empty result from
   inspection failure and document the requirement.
3. **Exact ref verification** — introduce ref maps and mismatch diagnostics.
4. **CI and v0.2.0 readiness** — update supported Node.js versions, add the CI
   workflow, consolidate release notes, and complete acceptance evidence.

These units may be combined when implementation reveals inseparable
interfaces. They must not be split further merely to create additional
commits or pull requests.

## Testing Strategy

### Unit tests

- Assert that Git child-process arguments and repository URLs never contain a
  token or derived authorization value.
- Assert that runtime authentication configuration is scoped to the child
  process and target repository URL.
- Assert that raw, encoded, and derived secret forms are redacted from
  failures.
- Assert that a successful empty LFS listing returns `false`.
- Assert that a non-empty LFS listing returns `true`.
- Assert that missing or failing Git LFS raises a typed error.
- Assert exact ref-map equality and deterministic diagnostics for missing,
  unexpected, and mismatched refs.
- Assert conversion stops before push when LFS inspection fails.

### Integration and acceptance tests

- Run the full automated suite on every supported CI matrix entry.
- Confirm the built CLI help executes from `dist`.
- Use authorized disposable repositories to validate a normal fork
  conversion with multiple branches and tags.
- If an LFS fixture is used, verify the target can fetch the migrated object
  and that source and target ref maps match.
- Inspect the temporary mirror during a controlled test to confirm its remote
  URL contains no credentials.
- Record commands, sanitized outputs, source/target identifiers, and cleanup
  status in the release evidence.

No acceptance test may expose a token, operate on an unapproved repository, or
delete a repository without separate authorization.

## Release Criteria

v0.2.0 is releasable only when:

- all unit tests, type checks, builds, and CLI smoke tests pass locally;
- the complete CI matrix passes;
- credentialed URLs are absent from code paths, tests, reports, and sanitized
  acceptance evidence;
- LFS inspection failures stop conversion before mirror push;
- exact source and target branch/tag ref parity is demonstrated;
- README requirements and recovery guidance match implemented behavior;
- an independent tester has completed the agreed acceptance checks;
- review findings are resolved;
- the release notes describe the Node.js support change and recovery impact;
- the working tree is clean and the release commit is traceable to the merged
  pull requests.

Creating the GitHub release, changing repository settings, and deleting
disposable test repositories remain separate external actions requiring
their own authorization.
