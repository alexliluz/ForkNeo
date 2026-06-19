# ForkNeo Design

## Purpose

ForkNeo is a Node.js and TypeScript CLI that converts a GitHub fork into a new independent repository while preserving Git history, refs, and Git LFS objects when present. It also scans an account for forks and verifies conversion results.

The tool preserves Git data only. It does not migrate GitHub issues, pull requests, stars, watchers, Actions history, secrets, branch protection, webhooks, or other repository settings. Users remain responsible for preserving licenses, notices, copyright, and attribution.

## Command Surface

```text
forkneo scan
forkneo convert owner/repo [--name target-name] [--suffix neo] [--yes]
forkneo verify owner/repo-neo [--source owner/repo]
```

`scan` lists fork repositories owned by the authenticated user. `convert` creates an independent target repository and mirrors Git data into it. `verify` checks that a target is independent and optionally compares its refs and latest default-branch commit with the source.

## Architecture

The CLI uses four focused layers:

- `src/commands`: parses command options, coordinates workflows, and presents results.
- `src/github`: authenticates with GitHub and wraps repository API operations.
- `src/git`: performs mirror clone, mirror push, Git LFS migration, and local ref inspection.
- `src/utils`: owns naming, temporary directories, reports, logging, and user-facing errors.

Dependencies are injected into command handlers so workflows can be tested without GitHub access or shelling out to Git. Production adapters use Octokit and Execa.

## Authentication

ForkNeo first reads `GITHUB_TOKEN`. If it is absent, it asks the installed GitHub CLI for a token with `gh auth token`. Failure to obtain a token produces an actionable authentication error. Octokit handles all GitHub API calls.

Git transport uses an HTTPS URL containing the token only for the lifetime of the child process. Tokens are redacted from errors and never written into reports.

## Scan Flow

1. Resolve authentication and current GitHub user.
2. Page through repositories owned by that user.
3. Keep repositories where `fork` is true.
4. Fetch upstream metadata when needed.
5. Print a stable table containing full name, upstream, visibility, archived state, size, primary language, default branch, last push, and license.

## Convert Flow

1. Parse and validate `owner/repo`.
2. Fetch the source and reject repositories that are not forks.
3. Compute the target name from `--name` or `<source>-<suffix>`, with `neo` as the default suffix.
4. Reject an existing target repository before any local Git work.
5. Prompt for confirmation unless `--yes` is supplied.
6. Create the target repository in the source owner's account, preserving visibility and description where practical.
7. Create an isolated temporary directory and run `git clone --mirror`.
8. Detect Git LFS use. When used, run `git lfs fetch --all` against the source and `git lfs push --all` to the target.
9. Push all refs with `git push --mirror`.
10. Set the target default branch to match the source when that branch exists.
11. Verify the target and write a Markdown report under `.forkneo/reports`.
12. Remove the temporary directory in a `finally` block.

If target creation succeeds but migration later fails, ForkNeo keeps the target repository and reports its name plus the failed stage. It does not delete remote data automatically.

## Verify Flow

Verification requires the target repository to exist, have `fork === false`, expose its default branch, and allow its latest commit, branches, and tags to be read. With `--source`, ForkNeo additionally compares the latest default-branch commit SHA plus branch and tag name sets. Differences are reported explicitly and result in a non-zero exit code.

## Errors And Output

Known failures use typed `ForkNeoError` values with a stable code, concise message, and optional recovery hint. Unexpected errors are wrapped without exposing credentials. Interactive output uses Ora and Chalk; tests and non-TTY environments receive deterministic plain text.

## Testing

Vitest covers parsers, naming, authentication fallback, repository adapters, Git command construction, report generation, and command orchestration. Command tests inject fake GitHub and Git services. A build and CLI help smoke test validate packaging without requiring live GitHub credentials.

Live conversion is intentionally outside automated tests because it creates remote repositories. The README documents a disposable-repository manual acceptance procedure.

## Deliverables

The package includes a `forkneo` binary, TypeScript declarations, source maps, unit tests, an environment example, a Git ignore file, an empty reports directory marker, and a README covering installation, authentication, commands, limitations, safety, and acceptance testing.
