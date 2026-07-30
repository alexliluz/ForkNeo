# ForkNeo Credential Transport Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate Git and Git LFS operations without placing a GitHub token in command arguments, repository URLs, persisted Git configuration, reports, or surfaced errors.

**Architecture:** A pure authentication helper validates credential-free HTTPS repository URLs and builds child-only Git runtime configuration. `ShellGitService` passes the ordinary URL in every argument array, applies the helper's environment only to the relevant child process, and sanitizes failures before wrapping them.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Execa 9, Vitest 4, Git runtime configuration, GitHub HTTPS token authentication.

## Global Constraints

- Use Node.js `>=22`.
- Accept only credential-free HTTPS repository URLs in authenticated Git paths.
- Never place the raw token, URL-encoded token, Basic credential, or generated `Authorization` header in command arguments, persisted URLs, reports, or surfaced errors.
- Scope the HTTP authorization header to the exact source or target repository URL.
- Set `GIT_TERMINAL_PROMPT=0` for authenticated child processes.
- Do not mutate `process.env`, global Git configuration, local Git configuration, or repository Git configuration.
- Keep `alexliluz` as the maintainer of core implementation; credit `ASEnough` only for content it actually contributes.
- Do not push, merge, change repository settings, or perform acceptance operations without the separately required authorization.

---

## File Map

- Create `src/git/auth.ts`: validate repository URLs, construct child-only Git authentication environment, and redact all derived secret forms.
- Create `tests/git/auth.test.ts`: pure tests for URL validation, environment scoping, immutability, and redaction.
- Modify `src/git/mirror.ts`: remove credentialed URL construction and use child-only authentication for clone, fetch, and push.
- Modify `src/types/index.ts`: pass the credential-free source URL to authenticated LFS fetches.
- Modify `src/commands/convert.ts`: provide the source clone URL to `fetchAllLfs`.
- Modify `tests/git/mirror.test.ts`: prove argument arrays remain credential-free and failures are sanitized.
- Modify `tests/commands/convert.test.ts`: lock the updated `GitService` call contract.
- Modify `README.md`: document ephemeral authentication, HTTPS-only behavior, and non-interactive failure.

## Execution Prerequisites

- Start from the merged design baseline containing `docs/superpowers/specs/2026-07-30-forkneo-release-hardening-design.md`.
- Create `fix/credential-transport` from the current protected default branch only after branch creation is authorized.
- Before dependency installation, use Node.js 22 or newer with npm. The available Codex runtime is `/Users/alex/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` at v24.14.0, but it does not bundle npm; provisioning npm or another complete Node distribution must be separately authorized and kept under `.tmp/`.
- Run `npm ci` before the first test; do not replace or regenerate `package-lock.json`.

### Task 0: Record and Independently Reproduce the Security Defect

**Files:**

- External GitHub issue and sanitized reproduction evidence.

**Interfaces:**

- Consumes: the credentialed URL behavior in ForkNeo v0.1.0.
- Produces: one genuine security issue owned by `alexliluz` and, if `ASEnough` performs it, an independently authored reproduction or regression-test contribution.

- [ ] **Step 1: Check that an equivalent issue does not already exist**

Run:

```bash
gh issue list \
  --repo alexliluz/ForkNeo \
  --state all \
  --search '"credential" URL token in:title,body' \
  --json number,title,state,url
```

Expected: no existing issue covers tokens embedded in Git command URLs. If an equivalent issue exists, use it instead of creating a duplicate.

- [ ] **Step 2: Create the security issue**

After separate issue-creation authorization, run:

```bash
gh issue create \
  --repo alexliluz/ForkNeo \
  --title "Security: keep GitHub tokens out of Git command URLs" \
  --body '## Problem

ForkNeo v0.1.0 inserts the GitHub token into HTTPS URLs passed to `git clone`,
`git push`, and `git lfs push`. Those URLs can appear in process arguments and
the temporary mirror remote configuration.

## Required behavior

- pass credential-free HTTPS URLs in every argument array
- use child-only Git runtime configuration for the exact repository URL
- disable interactive credential prompts
- redact raw, encoded, Basic, and complete authorization-header forms
- reject non-HTTPS and already-credentialed URLs
- preserve credential-free remote URLs

## Verification

Unit tests must inspect command arguments, child environments, surfaced errors,
and error causes without printing a live token.'
```

Expected: one substantive issue authored by `alexliluz`.

- [ ] **Step 3: Offer a real secondary-account contribution**

Ask `ASEnough` to reproduce the v0.1.0 behavior in an independently controlled environment and contribute a sanitized regression-test case if it finds a platform-specific exposure. Never paste the live process environment, token, or authorization header into the issue.

Expected: if `ASEnough` contributes test content, preserve that exact content and authorship. If it does not, continue without a coauthor trailer or fabricated collaboration record.

### Task 1: Child-Only Git Authentication

**Files:**

- Create: `tests/git/auth.test.ts`
- Create: `src/git/auth.ts`

**Interfaces:**

- Consumes: a credential-free repository URL, a non-empty GitHub token, and an optional base `NodeJS.ProcessEnv`.
- Produces:
  - `GitAuthentication` with `url: string`, `env: NodeJS.ProcessEnv`, and `secrets: readonly string[]`.
  - `createGitAuthentication(url: string, token: string, baseEnv?: NodeJS.ProcessEnv): GitAuthentication`.
  - `redactGitSecrets(value: string, secrets: readonly string[]): string`.

- [ ] **Step 1: Write the failing authentication-helper tests**

Create `tests/git/auth.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import {
  createGitAuthentication,
  redactGitSecrets,
} from "../../src/git/auth.js";

describe("createGitAuthentication", () => {
  it("scopes a child-only authorization header to the exact HTTPS URL", () => {
    const baseEnv = { PATH: "/usr/bin", KEEP_ME: "yes" };
    const token = "github token/with spaces";

    const authentication = createGitAuthentication(
      "https://github.com/alex/project.git",
      token,
      baseEnv,
    );

    expect(authentication.url).toBe("https://github.com/alex/project.git");
    expect(authentication.url).not.toContain(token);
    expect(authentication.env).toMatchObject({
      PATH: "/usr/bin",
      KEEP_ME: "yes",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0:
        "http.https://github.com/alex/project.git.extraHeader",
    });
    expect(authentication.env.GIT_CONFIG_VALUE_0).toMatch(
      /^Authorization: Basic /,
    );
    expect(baseEnv).toEqual({ PATH: "/usr/bin", KEEP_ME: "yes" });
  });

  it.each([
    "http://github.com/alex/project.git",
    "ssh://git@github.com/alex/project.git",
    "git@github.com:alex/project.git",
    "https://user:password@github.com/alex/project.git",
  ])("rejects unsupported or credentialed transport %s", (url) => {
    const failure = (() => {
      try {
        createGitAuthentication(url, "secret");
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toMatchObject({ code: "UNSUPPORTED_GIT_TRANSPORT" });
  });

  it("redacts raw, encoded, and derived credentials", () => {
    const authentication = createGitAuthentication(
      "https://github.com/alex/project.git",
      "token/value",
      {},
    );
    const exposed = [
      "token/value",
      "token%2Fvalue",
      authentication.env.GIT_CONFIG_VALUE_0,
      authentication.secrets.find((value) =>
        value.startsWith("eC1hY2Nlc3MtdG9rZW46"),
      ),
    ].join(" ");

    const redacted = redactGitSecrets(exposed, authentication.secrets);

    expect(redacted).not.toContain("token/value");
    expect(redacted).not.toContain("token%2Fvalue");
    expect(redacted).not.toContain("Authorization: Basic");
    expect(redacted).toContain("[REDACTED]");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module is the only failure**

Run:

```bash
npm test -- tests/git/auth.test.ts
```

Expected: FAIL because `src/git/auth.ts` does not exist.

- [ ] **Step 3: Implement the authentication helper**

Create `src/git/auth.ts` with:

```ts
import { ForkNeoError } from "../utils/errors.js";

export interface GitAuthentication {
  url: string;
  env: NodeJS.ProcessEnv;
  secrets: readonly string[];
}

function uniqueSecrets(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
}

export function createGitAuthentication(
  value: string,
  token: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): GitAuthentication {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ForkNeoError(
      "UNSUPPORTED_GIT_TRANSPORT",
      "Authenticated Git operations require a credential-free HTTPS URL.",
      "Use the repository HTTPS clone URL.",
    );
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ForkNeoError(
      "UNSUPPORTED_GIT_TRANSPORT",
      `Authenticated Git operations require a credential-free HTTPS URL: ${url.origin}`,
      "Use the repository HTTPS clone URL without embedded credentials.",
    );
  }

  const repositoryUrl = url.toString();
  const basicCredential = Buffer.from(
    `x-access-token:${token}`,
    "utf8",
  ).toString("base64");
  const authorizationHeader = `Authorization: Basic ${basicCredential}`;

  return {
    url: repositoryUrl,
    env: {
      ...baseEnv,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${repositoryUrl}.extraHeader`,
      GIT_CONFIG_VALUE_0: authorizationHeader,
    },
    secrets: uniqueSecrets([
      token,
      encodeURIComponent(token),
      basicCredential,
      authorizationHeader,
    ]),
  };
}

export function redactGitSecrets(
  value: string,
  secrets: readonly string[],
): string {
  return secrets.reduce(
    (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
    value,
  );
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```bash
npm test -- tests/git/auth.test.ts
```

Expected: PASS with 3 tests and all parameterized URL cases.

- [ ] **Step 5: Commit the pure authentication helper**

After separate staging and commit authorization, use the ordinary commit when
`alexliluz` wrote all content:

```bash
git add src/git/auth.ts tests/git/auth.test.ts
git diff --cached --check
git commit -m "feat: add ephemeral Git authentication"
```

If and only if `ASEnough` contributed test content that is included in this
same commit, use:

```bash
git add src/git/auth.ts tests/git/auth.test.ts
git diff --cached --check
git commit \
  -m "feat: add ephemeral Git authentication" \
  -m "Co-authored-by: ASEnough <295963714+ASEnough@users.noreply.github.com>"
```

Expected: one commit containing only the helper and its tests, with authorship
matching the content actually contributed.

### Task 2: Credential-Free Git and Git LFS Commands

**Files:**

- Modify: `tests/git/mirror.test.ts`
- Modify: `tests/commands/convert.test.ts`
- Modify: `src/git/mirror.ts`
- Modify: `src/types/index.ts`
- Modify: `src/commands/convert.ts`

**Interfaces:**

- Consumes: `createGitAuthentication` and `redactGitSecrets` from Task 1.
- Produces:
  - `GitService.fetchAllLfs(directory: string, sourceUrl: string, token: string): Promise<void>`.
  - Credential-free argument arrays for `cloneMirror`, `pushMirror`, `fetchAllLfs`, and `pushAllLfs`.
  - Sanitized `ForkNeoError` instances whose message and cause contain no derived secret.

- [ ] **Step 1: Replace credentialed-argument expectations with security assertions**

In `tests/git/mirror.test.ts`, replace the existing clone/push and redaction tests with:

```ts
it("keeps credentials out of mirror command arguments and repository URLs", async () => {
  const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
  const git = new ShellGitService(run);

  await git.cloneMirror(
    "https://github.com/a/source.git",
    "C:/tmp/repo.git",
    "secret",
  );
  await git.pushMirror(
    "C:/tmp/repo.git",
    "https://github.com/a/target.git",
    "secret",
  );

  expect(run).toHaveBeenNthCalledWith(
    1,
    "git",
    [
      "clone",
      "--mirror",
      "https://github.com/a/source.git",
      "C:/tmp/repo.git",
    ],
    expect.objectContaining({
      env: expect.objectContaining({
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_KEY_0:
          "http.https://github.com/a/source.git.extraHeader",
      }),
    }),
  );
  expect(run).toHaveBeenNthCalledWith(
    2,
    "git",
    ["push", "--mirror", "https://github.com/a/target.git"],
    expect.objectContaining({
      cwd: "C:/tmp/repo.git",
      env: expect.objectContaining({
        GIT_CONFIG_KEY_0:
          "http.https://github.com/a/target.git.extraHeader",
      }),
    }),
  );

  for (const [, args] of run.mock.calls) {
    expect(args.join(" ")).not.toContain("secret");
    expect(args.join(" ")).not.toContain("x-access-token");
  }
});

it("sanitizes raw and derived credentials from failures and causes", async () => {
  const basicCredential = Buffer.from(
    "x-access-token:token/value",
    "utf8",
  ).toString("base64");
  const run = vi.fn().mockRejectedValue(
    new Error(
      [
        "token/value",
        "token%2Fvalue",
        basicCredential,
        `Authorization: Basic ${basicCredential}`,
      ].join(" "),
    ),
  );
  const git = new ShellGitService(run);

  const failure = await git
    .cloneMirror(
      "https://github.com/a/source.git",
      "C:/tmp/repo.git",
      "token/value",
    )
    .catch(
      (error: unknown) =>
        error as Error & { code: string; cause?: unknown },
    );

  expect(failure).toMatchObject({ code: "GIT_COMMAND_FAILED" });
  expect(String(failure)).not.toContain("token/value");
  expect(String(failure)).not.toContain("token%2Fvalue");
  expect(String(failure)).not.toContain(basicCredential);
  expect(String(failure.cause)).not.toContain("token/value");
  expect(String(failure.cause)).not.toContain(basicCredential);
});
```

Update the LFS migration test so its fetch and push assertions are:

```ts
await git.fetchAllLfs(
  "C:/tmp/repo.git",
  "https://github.com/a/source.git",
  "secret",
);
await git.pushAllLfs(
  "C:/tmp/repo.git",
  "https://github.com/a/target.git",
  "secret",
);

expect(run).toHaveBeenCalledWith(
  "git",
  ["lfs", "fetch", "--all", "origin"],
  expect.objectContaining({
    cwd: "C:/tmp/repo.git",
    env: expect.objectContaining({
      GIT_CONFIG_KEY_0:
        "http.https://github.com/a/source.git.extraHeader",
    }),
  }),
);
expect(run).toHaveBeenCalledWith(
  "git",
  ["lfs", "push", "--all", "https://github.com/a/target.git"],
  expect.objectContaining({
    cwd: "C:/tmp/repo.git",
    env: expect.objectContaining({
      GIT_CONFIG_KEY_0:
        "http.https://github.com/a/target.git.extraHeader",
    }),
  }),
);
```

In `tests/commands/convert.test.ts`, add this assertion after the existing `fetchAllLfs` assertion:

```ts
expect(git.fetchAllLfs).toHaveBeenCalledWith(
  expect.any(String),
  source.cloneUrl,
  "secret",
);
```

- [ ] **Step 2: Run the focused tests and verify they expose credentialed URLs and the old LFS signature**

Run:

```bash
npm test -- tests/git/mirror.test.ts tests/commands/convert.test.ts
```

Expected: FAIL because mirror arguments still contain `x-access-token:secret`, child authentication environment is absent, and `fetchAllLfs` accepts only two arguments.

- [ ] **Step 3: Update the service contract and conversion call**

In `src/types/index.ts`, replace the `fetchAllLfs` signature with:

```ts
fetchAllLfs(
  directory: string,
  sourceUrl: string,
  token: string,
): Promise<void>;
```

In `src/commands/convert.ts`, replace the LFS fetch call with:

```ts
await dependencies.git.fetchAllLfs(
  mirrorDirectory,
  source.cloneUrl,
  dependencies.token,
);
```

- [ ] **Step 4: Replace credentialed URLs in the Git adapter**

Replace `src/git/mirror.ts` with:

```ts
import { execa, type Options } from "execa";

import { ForkNeoError } from "../utils/errors.js";
import {
  createGitAuthentication,
  redactGitSecrets,
} from "./auth.js";

type CommandResult = { stdout: string; stderr: string };
type CommandRunner = (
  file: string,
  args: string[],
  options: Options,
) => Promise<CommandResult>;

const defaultRunner: CommandRunner = async (file, args, options) => {
  const result = await execa(file, args, options);
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
};

export class ShellGitService {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  private async execute(
    operation: string,
    args: string[],
    options: Options,
    secrets: readonly string[] = [],
  ): Promise<CommandResult> {
    try {
      return await this.run("git", args, options);
    } catch (error) {
      const detail = redactGitSecrets(
        error instanceof Error ? error.message : String(error),
        secrets,
      );
      const message = `Git ${operation} failed: ${detail}`;
      throw new ForkNeoError(
        "GIT_COMMAND_FAILED",
        message,
        "Run with a valid token and confirm Git and Git LFS are installed.",
        { cause: new Error(message) },
      );
    }
  }

  private async executeAuthenticated(
    operation: string,
    args: string[],
    options: Options,
    repositoryUrl: string,
    token: string,
  ): Promise<CommandResult> {
    const authentication = createGitAuthentication(repositoryUrl, token);
    return this.execute(
      operation,
      args,
      { ...options, env: authentication.env },
      authentication.secrets,
    );
  }

  async cloneMirror(
    sourceUrl: string,
    directory: string,
    token: string,
  ): Promise<void> {
    const authentication = createGitAuthentication(sourceUrl, token);
    await this.execute(
      "mirror clone",
      ["clone", "--mirror", authentication.url, directory],
      { reject: true, env: authentication.env },
      authentication.secrets,
    );
  }

  async pushMirror(
    directory: string,
    targetUrl: string,
    token: string,
  ): Promise<void> {
    const authentication = createGitAuthentication(targetUrl, token);
    await this.execute(
      "mirror push",
      ["push", "--mirror", authentication.url],
      { cwd: directory, reject: true, env: authentication.env },
      authentication.secrets,
    );
  }

  async pruneUnsupportedRefs(directory: string): Promise<void> {
    const result = await this.execute(
      "pull-request ref inspection",
      ["for-each-ref", "--format=%(refname)", "refs/pull"],
      { cwd: directory, reject: true },
    );
    const refs = result.stdout.split(/\r?\n/).filter(Boolean);
    if (refs.length === 0) {
      return;
    }
    await this.execute(
      "pull-request ref removal",
      ["update-ref", "--stdin"],
      {
        cwd: directory,
        input: `${refs.map((ref) => `delete ${ref}`).join("\n")}\n`,
        reject: true,
      },
    );
  }

  async hasLfs(directory: string): Promise<boolean> {
    try {
      const result = await this.run(
        "git",
        ["lfs", "ls-files", "--all", "--name-only"],
        { cwd: directory, reject: true },
      );
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async fetchAllLfs(
    directory: string,
    sourceUrl: string,
    token: string,
  ): Promise<void> {
    await this.executeAuthenticated(
      "LFS fetch",
      ["lfs", "fetch", "--all", "origin"],
      { cwd: directory, reject: true },
      sourceUrl,
      token,
    );
  }

  async pushAllLfs(
    directory: string,
    targetUrl: string,
    token: string,
  ): Promise<void> {
    const authentication = createGitAuthentication(targetUrl, token);
    await this.execute(
      "LFS push",
      ["lfs", "push", "--all", authentication.url],
      { cwd: directory, reject: true, env: authentication.env },
      authentication.secrets,
    );
  }
}
```

The temporary `hasLfs` catch remains unchanged in this delivery unit; the next plan replaces it with fail-closed behavior and dedicated tests.

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
npm test -- tests/git/auth.test.ts tests/git/mirror.test.ts tests/commands/convert.test.ts
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

Expected: all tests PASS, TypeScript exits 0, tsup emits `dist/index.js` and declarations, and CLI help lists `scan`, `convert`, and `verify`.

- [ ] **Step 6: Inspect the built output and diff for credential construction**

Run:

```bash
rg -n 'x-access-token:|authenticatedUrl|url\\.username|url\\.password' src tests dist README.md
git diff --check
git status --short
```

Expected: `authenticatedUrl` is absent; `url.username` and `url.password` appear only in rejection checks; `x-access-token:` appears only in the in-memory Basic-credential construction and its tests. Only intended source and test files are modified; `dist/` remains ignored.

- [ ] **Step 7: Commit the adapter integration**

After separate staging and commit authorization:

```bash
git add src/git/mirror.ts src/types/index.ts src/commands/convert.ts tests/git/mirror.test.ts tests/commands/convert.test.ts
git diff --cached --check
git commit -m "fix: keep Git credentials out of command URLs"
```

Expected: one commit containing the service contract, implementation, and regression tests.

### Task 3: Authentication Safety Documentation and PR Evidence

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: the behavior verified in Tasks 1 and 2.
- Produces: user-facing requirements and recovery guidance that match the implementation.

- [ ] **Step 1: Replace the README authentication safety guidance**

Under `## Authentication`, after the token lookup order, add:

```markdown
ForkNeo accepts only credential-free GitHub HTTPS clone URLs. For each Git or
Git LFS child process it supplies a repository-scoped HTTP authorization header
through child-only Git runtime configuration. The token is not added to command
arguments or saved in the temporary mirror's remote URL.

Authenticated Git commands are non-interactive. If the token is invalid or
lacks access, ForkNeo fails instead of opening a credential prompt. Reauthenticate
with `gh auth login` or replace `GITHUB_TOKEN`, then retry with a new target name
or follow the reported manual-recovery guidance for an already-created target.
```

Under `## Safety Notes`, add:

```markdown
- Authenticated clone and push paths require credential-free HTTPS repository URLs; SSH and URLs containing credentials are rejected.
- Treat process environments and diagnostic dumps as sensitive even though ForkNeo redacts known token forms from surfaced Git errors.
```

- [ ] **Step 2: Run documentation and repository checks**

Run:

```bash
rg -n "credential-free|child-only|non-interactive|HTTPS" README.md
rg -n 'x-access-token:|https://[^/@]+:[^/@]+@' README.md src tests
git diff --check
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

Expected: the first search finds the new guidance; the second search finds only the in-memory Basic-credential construction and deliberate credential-rejection/redaction fixtures, never a production command argument or documentation example; all verification commands exit 0.

- [ ] **Step 3: Commit the documentation**

After separate staging and commit authorization:

```bash
git add README.md
git diff --cached --check
git commit -m "docs: explain ephemeral Git authentication"
```

Expected: one documentation-only commit.

- [ ] **Step 4: Prepare truthful review evidence**

Record in the pull-request description:

```markdown
## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- `node dist/index.js --help`
- inspected Git argument arrays: credential-free
- inspected temporary remote URL behavior: credential-free by construction
- inspected surfaced error and cause: raw, encoded, Basic, and header forms redacted

## Scope

- no repository settings changed
- no remote repository created
- no token printed or persisted
```

Expected: every checked statement is backed by the commands and tests from this plan. Do not mark an item complete if its evidence was not observed.

- [ ] **Step 5: Open the delivery-unit pull request**

After separate push and pull-request authorizations, push `fix/credential-transport` and open one pull request owned by `alexliluz`. Request `ASEnough` review only if that account will independently inspect the diff and verification evidence. Do not add a coauthor trailer unless both accounts actually contributed content to the same commit.

Expected: one technically meaningful pull request for credential transport hardening, with no unrelated changes.
