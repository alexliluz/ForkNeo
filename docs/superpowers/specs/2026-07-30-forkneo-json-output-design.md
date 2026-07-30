# ForkNeo Machine-Readable Output Design

- **Status:** Approved
- **Date:** 2026-07-30
- **Primary maintainer:** `alexliluz`

## Context

ForkNeo currently writes human-oriented text for `scan`, `convert`, and
`verify`. Automation has to parse tab-separated tables, colored success
messages, and prose. That is fragile and makes otherwise scriptable read
operations difficult to integrate safely.

The command functions already return structured results for `convert` and
`verify`. `scan` is the exception: it combines GitHub access and table
rendering and returns no value.

## Goals

- Add `--json` to `scan`, `convert`, and `verify`.
- Write exactly one valid JSON document to stdout on success.
- Preserve all existing human-readable output when `--json` is absent.
- Return an empty repository array from `scan --json` rather than prose.
- Reuse command result objects instead of parsing human output.
- Keep secrets, authentication headers, and credential-derived values out of
  every JSON document.

## Non-Goals

- A machine-readable error protocol. Errors continue to use the existing
  stderr text and non-zero exit behavior.
- JSON Lines, streaming output, pagination tokens, or schema negotiation.
- Changing GitHub API calls, conversion ordering, verification rules, or
  migration reports.
- Adding a dependency or changing the Node.js runtime floor.
- Splitting JSON support into multiple pull requests solely to create
  additional activity.

## Considered Approaches

### Per-command `--json` for all commands

This is the selected approach. Each command owns its output contract, so the
option works in the normal Commander position:

```text
forkneo scan --json
forkneo convert owner/project --dry-run --json
forkneo verify owner/project-neo --source owner/project --json
```

It keeps the implementation local to each successful command action and does
not require global parser or error-state plumbing.

### One global `--json` option

A global flag appears convenient but creates positional ambiguity and implies
that parse errors and runtime errors also have a JSON contract. Implementing
that correctly requires a larger error-protocol design and is out of scope.

### JSON only for read-oriented commands

Supporting `scan` and `verify` but not `convert` would leave the new dry-run
preflight unnecessarily hard to automate. The existing `ConvertResult` union
already provides a safe schema for both dry-run and completed conversion
results.

## Output Contracts

### `scan --json`

```json
{
  "repositories": [
    {
      "owner": "alex",
      "name": "project",
      "fullName": "alex/project",
      "isFork": true,
      "isPrivate": false,
      "visibility": "public",
      "archived": false,
      "size": 42,
      "language": "TypeScript",
      "defaultBranch": "main",
      "pushedAt": "2026-07-30T00:00:00Z",
      "license": "MIT",
      "description": "Example",
      "cloneUrl": "https://github.com/alex/project.git",
      "htmlUrl": "https://github.com/alex/project",
      "parentFullName": "upstream/project"
    }
  ]
}
```

The array preserves the GitHub service order. An account with no forks emits:

```json
{
  "repositories": []
}
```

Repository URLs are credential-free values already returned by the GitHub
API. No token or generated authorization value is present.

### `convert --json`

Dry-run success emits the existing discriminated result:

```json
{
  "mode": "dry-run",
  "source": "alex/project",
  "target": "alex/project-neo",
  "defaultBranch": "main",
  "refCount": 3,
  "lfsDetected": true
}
```

Completed conversion emits:

```json
{
  "mode": "converted",
  "source": "alex/project",
  "target": "alex/project-neo",
  "reportPath": ".forkneo/reports/example.md",
  "lfsMigrated": true
}
```

JSON mode changes presentation only. It does not imply `--dry-run`.

### `verify --json`

```json
{
  "verified": true,
  "target": "alex/project-neo",
  "defaultBranch": "main",
  "refCount": 3
}
```

## Architecture

`runScan` will return:

```ts
export interface ScanResult {
  repositories: RepositoryInfo[];
}
```

It will no longer accept an output writer. Human table rendering moves to a
pure CLI helper that consumes `ScanResult`. This aligns `scan` with the
existing command/result boundary used by `convert` and `verify`.

The CLI adds `--json` to each subcommand and serializes successful results
with:

```ts
JSON.stringify(result, null, 2)
```

The writer receives that string exactly once. Text branches retain their
current messages and table fields.

Status spinners continue to use stderr. JSON remains isolated on stdout, and
non-interactive execution already suppresses spinners.

## Error and Security Boundaries

- Success JSON never contains the GitHub token, Git child configuration,
  authorization values, or error causes.
- Runtime failures continue through `formatCliError`, stderr, and exit code 1.
- Commander parse errors remain human-readable.
- JSON serialization happens only after the command operation succeeds.
- Private repository metadata is returned only to the authenticated caller
  who already has access through `scan`.

## Testing Strategy

- `runScan` returns a complete repository array and an empty array without
  writing output.
- Text-mode `scan` retains its existing header, row, and empty-account
  messages.
- Each command registers `--json`.
- Each JSON action writes exactly once and parses successfully.
- Dry-run JSON contains no migration report and triggers no remote mutation.
- Converted and verified JSON use the existing typed result fields.
- Text-mode regression assertions remain unchanged.
- Full unit tests, type checking, build, root help, and all three command help
  screens pass.
- The complete 3 OS by 3 Node CI matrix and aggregate check pass before merge.

## Delivery and Provenance

This is one independently valuable feature and one pull request. `alexliluz`
owns the design, implementation, tests, documentation, PR, and merge.
`ASEnough` may perform a real final review after the last push and complete CI,
but receives no code authorship unless it contributes code included in the
commit.

## Success Criteria

- All three commands support the documented successful JSON forms.
- Successful JSON mode writes one parseable document and no human success
  prose to stdout.
- Existing text output remains compatible.
- `scan` uses a structured command result rather than embedded rendering.
- No dependency, authentication, mutation, or error-protocol behavior changes.
- Local and repository verification gates pass without bypass.
