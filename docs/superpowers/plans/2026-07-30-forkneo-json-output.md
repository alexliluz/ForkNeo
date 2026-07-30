# ForkNeo Machine-Readable Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add successful machine-readable JSON output to all three ForkNeo commands without changing their operations or existing text output.

**Architecture:** `runScan` becomes a structured command function like `runConvert` and `runVerify`, while the CLI owns table and prose rendering. Each subcommand receives a local `--json` option and writes its successful result as one indented JSON document; errors retain the existing stderr contract.

**Tech Stack:** TypeScript 5.9, Node.js 22+, Commander 15, Vitest 4, tsup 8.

## Global Constraints

- `scan`, `convert`, and `verify` all receive `--json` in one feature PR.
- JSON mode writes exactly one document to stdout and no human success prose.
- Text output remains compatible when `--json` is absent.
- Errors remain human-readable on stderr with non-zero exit status.
- No token, generated authorization value, or error cause enters JSON output.
- No dependencies, GitHub operations, conversion stages, or runtime floors change.
- `alexliluz` owns the code and commits; `ASEnough` performs only genuine review unless it contributes code.

---

### Task 1: Return structured scan data

**Files:**
- Modify: `tests/commands/scan.test.ts`
- Modify: `src/commands/scan.ts`

**Interfaces:**
- Produces:

```ts
export interface ScanResult {
  repositories: RepositoryInfo[];
}

export async function runScan(
  github: GitHubService,
): Promise<ScanResult>
```

- [ ] **Step 1: Write the failing command tests**

Replace writer assertions with complete result assertions:

```ts
await expect(runScan(github as never)).resolves.toEqual({
  repositories: [repository],
});
```

For the empty account:

```ts
await expect(
  runScan({ listForks: vi.fn().mockResolvedValue([]) } as never),
).resolves.toEqual({ repositories: [] });
```

- [ ] **Step 2: Verify RED**

Run:

```text
npm test -- tests/commands/scan.test.ts
```

Expected: both assertions fail because `runScan` currently returns `undefined`.

- [ ] **Step 3: Implement the structured result**

Remove the writer and logger imports from `src/commands/scan.ts`. Return:

```ts
const repositories = await github.listForks();
return { repositories };
```

Do not sort, filter, or map the service result.

- [ ] **Step 4: Verify GREEN**

Run:

```text
npm test -- tests/commands/scan.test.ts
npm run typecheck
```

Type checking may still fail in `src/cli.ts` until Task 2 updates the caller;
the command test itself must pass.

---

### Task 2: Preserve scan text rendering and add scan JSON

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `ScanResult` from Task 1.
- Produces: `scan --json` and existing table/prose output.

- [ ] **Step 1: Write failing CLI tests**

Add a scan text test that requires the existing tab-separated header and
repository row. Add an empty text test that requires:

```text
No fork repositories found.
```

Add a JSON test that parses the writer's only call:

```ts
expect(write).toHaveBeenCalledTimes(1);
expect(JSON.parse(write.mock.calls[0][0])).toEqual({
  repositories: [repository()],
});
```

Assert that the scan command registers `--json`.

- [ ] **Step 2: Verify RED**

Run:

```text
npm test -- tests/cli.test.ts
```

Expected: JSON option/output assertions fail and the current scan caller no
longer matches the Task 1 signature.

- [ ] **Step 3: Add presentation helpers**

In `src/cli.ts`, define:

```ts
interface JsonOutputOptions {
  json?: boolean;
}

function writeJson(write: OutputWriter, value: unknown): void {
  write(JSON.stringify(value, null, 2));
}
```

Move the previous scan table behavior into:

```ts
function writeScanResult(
  repositories: RepositoryInfo[],
  write: OutputWriter,
): void
```

It must preserve the exact current header, field order, fallbacks, archived
labels, and empty-account sentence.

- [ ] **Step 4: Wire `scan --json`**

Change the action to:

```ts
.option("--json", "write machine-readable JSON")
.action(async (options: JsonOutputOptions) => {
  const dependencies = await resolveDependencies(provider);
  const result = await withStatus(
    "Scanning GitHub forks",
    () => runScan(dependencies.github),
  );
  if (options.json) {
    writeJson(dependencies.write, result);
    return;
  }
  writeScanResult(result.repositories, dependencies.write);
});
```

- [ ] **Step 5: Verify GREEN**

Run:

```text
npm test -- tests/commands/scan.test.ts tests/cli.test.ts
npm run typecheck
```

Expected: focused tests and type checking pass.

---

### Task 3: Add convert and verify JSON output

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: existing `ConvertResult` and `VerifyResult`.
- Produces: per-command `--json` presentation with no domain option changes.

- [ ] **Step 1: Write failing option and JSON tests**

Require `--json` in both command option lists.

For convert dry-run, reuse complete GitHub and Git service doubles and parse
the writer's only call:

```ts
expect(write).toHaveBeenCalledTimes(1);
expect(JSON.parse(write.mock.calls[0][0])).toEqual({
  mode: "dry-run",
  source: "alex/project",
  target: "alex/project-independent",
  defaultBranch: "main",
  refCount: 3,
  lfsDetected: true,
});
```

For verify:

```ts
expect(write).toHaveBeenCalledTimes(1);
expect(JSON.parse(write.mock.calls[0][0])).toEqual({
  verified: true,
  target: "alex/project-neo",
  defaultBranch: "main",
  refCount: 2,
});
```

The dry-run test must retain no-confirmation, no-LFS-fetch, and no-create
assertions.

- [ ] **Step 2: Verify RED**

Run:

```text
npm test -- tests/cli.test.ts
```

Expected: Commander rejects or ignores `--json`, and multiple human output
calls violate the JSON assertions.

- [ ] **Step 3: Add CLI-only option types**

Use:

```ts
type ConvertCliOptions = ConvertOptions & JsonOutputOptions;
type VerifyCliOptions = VerifyOptions & JsonOutputOptions;
```

Do not add `json` to `ConvertOptions` or `VerifyOptions`; it is not a command
operation setting.

- [ ] **Step 4: Wire convert JSON**

Register:

```ts
.option("--json", "write machine-readable JSON")
```

After `runConvert` succeeds:

```ts
if (options.json) {
  writeJson(dependencies.write, result);
  return;
}
```

Keep the existing dry-run and converted text branches after that return.

- [ ] **Step 5: Wire verify JSON**

Register the same option. After `runVerify` succeeds:

```ts
if (options.json) {
  writeJson(dependencies.write, result);
  return;
}
```

Keep the existing verified sentence otherwise.

- [ ] **Step 6: Verify GREEN**

Run:

```text
npm test -- tests/cli.test.ts tests/commands/convert.test.ts tests/commands/verify.test.ts
npm run typecheck
```

Expected: all focused tests and type checking pass.

---

### Task 4: Document and verify the public contract

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all three JSON command forms.
- Produces: user-facing examples and explicit error/output boundaries.

- [ ] **Step 1: Add documentation**

Add a `Machine-readable output` section after command usage with:

```text
forkneo scan --json
forkneo convert owner/project --dry-run --json
forkneo verify owner/project-neo --source owner/project --json
```

State that success writes one JSON document to stdout, status activity uses
stderr, and failures retain text on stderr with a non-zero exit. Include the
empty scan shape and note that `--json` does not imply `--dry-run`.

- [ ] **Step 2: Run the complete gate**

Run:

```text
npm test
npm run typecheck
npm run build
node dist/index.js --help
node dist/index.js scan --help
node dist/index.js convert --help
node dist/index.js verify --help
git diff --check
```

Expected: 0 failures; every command help contains `--json`; convert help also
contains `--dry-run`.

- [ ] **Step 3: Audit output and secrets**

Verify the diff contains no dependency or lockfile change, token pattern,
credential header, or private environment value. Confirm every JSON branch
returns before its human output branch and writes exactly once.

- [ ] **Step 4: Commit**

Commit the source, tests, and README as `alexliluz` with:

```text
feat: add machine-readable command output
```

The approved design and this plan are recorded in the preceding documentation
commit.

Do not add a co-author trailer unless another account contributes code to the
commit.

---

### Task 5: Deliver through repository gates

**Files:**
- Remote branch: `feat/json-output`
- Remote PR in `alexliluz/ForkNeo`

**Interfaces:**
- Produces: one merged feature PR owned by `alexliluz`.

- [ ] **Step 1: Push and open a PR**

Summarize all three commands, the scan command/presentation boundary, text
compatibility, and exact local evidence. Do not mention achievements.

- [ ] **Step 2: Require full CI**

Wait for all 9 OS/Node jobs and aggregate `CI` to pass.

- [ ] **Step 3: Complete genuine ASEnough review**

Review the final diff, JSON-only stdout branches, text regressions, secret
boundary, and CI. Submit findings normally and approve only if supported.

- [ ] **Step 4: Merge without bypass**

After final approval and CI, merge as `alexliluz` through the ruleset. Verify
the PR, commit, and main contribution attribution.
