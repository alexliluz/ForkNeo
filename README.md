# ForkNeo

ForkNeo is a TypeScript CLI that converts a GitHub fork into a new independent repository while preserving Git history, branches, tags, default branch, and Git LFS objects when present.

It is built for the practical case where you want to keep the code history of a fork, but stop treating the target repository as a GitHub fork relationship.

## What It Does

- Scans the authenticated GitHub account for fork repositories
- Creates a brand new target repository under the authenticated user
- Mirrors the full Git repository history into the new target
- Preserves branches, tags, and default branch selection
- Migrates Git LFS objects when Git LFS is installed and used by the source
- Verifies that the target repository is independent and structurally matches the source
- Writes a migration report to `.forkneo/reports`

## What It Does Not Do

ForkNeo preserves the Git layer, not GitHub platform metadata.

It does not migrate:

- Issues, pull requests, discussions, stars, watchers, or forks
- Releases and uploaded release assets
- Actions runs, artifacts, environments, variables, or secrets
- Branch protection rules, rulesets, webhooks, deploy keys, collaborators, or repository settings

The target becomes independent because GitHub creates it as a normal repository with no `fork` relationship. ForkNeo does not attempt to hide provenance or rewrite project authorship.

## Requirements

- Node.js 20 or newer
- Git
- Git LFS when the source repository uses LFS
- GitHub CLI `gh` or a valid `GITHUB_TOKEN`
- A GitHub token that can read the source repository and create/push repositories for the authenticated user

## Install

```bash
npm install
npm run build
npm link
forkneo --help
```

For local development without linking:

```bash
npm run dev -- --help
```

## Authentication

ForkNeo checks authentication in this order:

1. `GITHUB_TOKEN`
2. The token returned by `gh auth token`

ForkNeo accepts only credential-free GitHub HTTPS clone URLs. For each Git or
Git LFS child process it supplies a repository-scoped HTTP authorization header
through child-only Git runtime configuration. The token is not added to command
arguments or saved in the temporary mirror's remote URL.

Authenticated Git commands are non-interactive. If the token is invalid or
lacks access, ForkNeo fails instead of opening a credential prompt. Reauthenticate
with `gh auth login` or replace `GITHUB_TOKEN`, then retry with a new target name
or follow the reported manual-recovery guidance for an already-created target.

### Option A: Use GitHub CLI

```bash
gh auth login
gh auth status
```

### Option B: Use `GITHUB_TOKEN`

Copy `.env.example` to `.env`, or export the variable in your shell:

```bash
export GITHUB_TOKEN=your_token_here
```

On PowerShell:

```powershell
$env:GITHUB_TOKEN="your_token_here"
```

Never commit `.env` or paste tokens into shared chat logs.

## Commands

### Scan

List fork repositories owned by the authenticated user:

```bash
forkneo scan
```

### Convert

Convert a fork using the default `-neo` suffix:

```bash
forkneo convert owner/project
```

Choose a specific target name:

```bash
forkneo convert owner/project --name project-independent
```

Choose a custom suffix:

```bash
forkneo convert owner/project --suffix next
```

Skip the confirmation prompt for scripted use:

```bash
forkneo convert owner/project --yes
```

### Verify

Verify that a target repository is independent:

```bash
forkneo verify owner/project-neo
```

Compare the target against the original source repository:

```bash
forkneo verify owner/project-neo --source owner/project
```

With `--source`, verification compares the latest default-branch commit plus the complete branch and tag name sets. Any mismatch returns a non-zero exit code.

## Typical Workflow

1. Authenticate with `gh auth login` or set `GITHUB_TOKEN`.
2. Run `forkneo scan` to see available forks in your account.
3. Pick a repository and run `forkneo convert owner/project`.
4. Inspect the new repository on GitHub.
5. Run `forkneo verify owner/project-neo --source owner/project`.
6. Apply any project-level cleanup you want in the new independent repository.

## Conversion Process

ForkNeo performs these steps:

1. Validates that the source repository is currently marked as a GitHub fork
2. Checks that the target repository name is available
3. Creates an empty repository for the authenticated user
4. Runs `git clone --mirror` against the source
5. Removes GitHub read-only refs such as `refs/pull/*`
6. Detects and migrates Git LFS objects when applicable
7. Runs `git push --mirror` to the new repository
8. Restores the default branch setting
9. Verifies branch and tag parity
10. Writes a report to `.forkneo/reports`

Temporary local mirror repositories are removed even when migration fails. If remote repository creation succeeds and a later stage fails, ForkNeo keeps the remote target in place and reports the state instead of deleting it automatically.

## Output

Migration reports are written to:

```text
.forkneo/reports/
```

Each report records:

- Source repository
- Target repository
- Default branch
- Branch count
- Tag count
- LFS detection result
- Verification status
- Completion timestamp

## Safety Notes

- ForkNeo creates a new repository. It does not delete or modify the original source repository.
- ForkNeo does not automatically delete remote targets after partial success.
- ForkNeo should be used with an account that is allowed to create repositories and push mirrored refs.
- Fine-grained access tokens still need enough scope to read the source and create/write the target.
- Authenticated clone and push paths require credential-free HTTPS repository URLs; SSH and URLs containing credentials are rejected.
- Treat process environments and diagnostic dumps as sensitive even though ForkNeo redacts known token forms from surfaced Git errors.

## Manual Acceptance Test

Use disposable repositories for an end-to-end validation:

1. Fork a small repository into your account.
2. Add a test branch and tag.
3. Add an LFS object if you also want to validate LFS migration.
4. Run `forkneo convert owner/source --name source-neo-test`.
5. Run `forkneo verify owner/source-neo-test --source owner/source`.
6. Inspect the generated report and the target repository on GitHub.
7. Delete the disposable repositories manually after testing.

## Development

```bash
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

## License

ForkNeo is released under the MIT License. Migrated repositories retain their own original licenses and attribution requirements.
