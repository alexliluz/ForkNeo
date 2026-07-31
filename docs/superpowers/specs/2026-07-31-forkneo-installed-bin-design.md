# ForkNeo Installed Bin Reliability Design

- **Status:** Approved under the standing execution authorization
- **Date:** 2026-07-31
- **Target:** The next ForkNeo patch release

## Context

ForkNeo v0.3.0 declares this executable:

```json
{
  "bin": {
    "forkneo": "dist/index.js"
  }
}
```

`src/index.ts` runs the CLI only when `process.argv[1]`, converted directly to
a file URL, equals `import.meta.url`. This succeeds for
`node dist/index.js --help`, which is the command currently exercised by CI.
It fails after a normal npm installation on POSIX because
`node_modules/.bin/forkneo` is a symlink while `import.meta.url` identifies
the real `dist/index.js` file.

A fresh v0.3.0 pack-and-install reproduction produced:

```text
installed forkneo --help:    exit 0, 0 output bytes
installed forkneo --version: exit 0, 0 output bytes
direct dist/index.js --help: exit 0, normal help output
```

The package is therefore structurally installable but its standard command
does no work. The current unit suite, type checking, build, and direct-file
smoke test all pass, so this needs both a runtime correction and a
package-boundary regression test.

## Goals

- Make the installed `forkneo` command execute through npm's POSIX symlink and
  Windows command shim.
- Keep `src/index.ts` safe to import without automatically starting the CLI.
- Preserve direct development execution through `tsx src/index.ts` and
  `node dist/index.js`.
- Exercise the actual packed artifact and installed `.bin` command in CI.
- Verify both `--help` and `--version`, including their expected output.
- Keep the correction small enough for a patch release.

## Non-Goals

- Publishing the package to npm.
- Creating or configuring an npm account, 2FA, trusted publishing, provenance,
  or registry credentials.
- Changing CLI commands, migration behavior, authentication, Git operations,
  output formats, or supported Node.js versions.
- Adding a library API or redesigning the build around multiple entrypoints.
- Expanding the existing esbuild advisory beyond its tracked upstream
  compatibility issue.

## Considered Approaches

### 1. Compare canonical real paths

Resolve both the invoked entry path and the current module file to canonical
filesystem paths before comparing them. Keep the existing single entrypoint.

This directly fixes the mismatch, preserves import safety, and changes neither
the package manifest nor the build topology. It is the recommended approach.

### 2. Add a dedicated executable wrapper

Create a second source entry that always calls `main()`, point `package.bin`
at that output, and leave the importable module separate.

This gives a clean conceptual boundary but introduces a second build entry,
additional package output, and more release configuration than the current
pure CLI needs. It remains a reasonable future option if ForkNeo exposes a
public library API.

### 3. Always call `main()` from `src/index.ts`

This removes the guard entirely and makes the installed command work, but any
import of the module would parse process arguments and may perform CLI work.
That side effect is not acceptable.

## Design

### Direct-execution predicate

Move the comparison into a small exported predicate so it can be tested
without starting Commander:

```text
isDirectExecution(argvEntry, moduleUrl) -> boolean
```

The predicate will:

1. return `false` when the argv entry is absent;
2. convert the module file URL to a filesystem path;
3. canonicalize both paths with Node's native realpath implementation;
4. compare the canonical paths;
5. return `false` if either path cannot be resolved.

Canonicalization makes a POSIX npm symlink and its target compare equal. On
Windows, npm's command shim already invokes the target JavaScript file, and
the same comparison remains valid.

Returning `false` on path-resolution failure is fail-safe for imports: an
unresolvable or synthetic argv value must not cause the CLI to start
unexpectedly. Normal direct execution always points to an existing entry
file.

The existing error boundary remains unchanged. When direct execution is
confirmed, `main()` runs and formats failures through `formatCliError`;
otherwise the module only exports its functions.

### Installed-package smoke test

Add a cross-platform Node script that tests the distributable boundary rather
than the source checkout:

1. create an isolated temporary directory;
2. run `npm pack --json` from the repository;
3. install that exact tarball into a second temporary prefix with lifecycle
   scripts disabled;
4. confirm the installed `.bin` entry exists, then run it through
   `npm exec --prefix <install-directory> -- forkneo`, which resolves the
   POSIX symlink or Windows `.cmd` shim;
5. assert `--help` exits zero and contains the CLI usage line;
6. assert `--version` exits zero and equals the version read from the package
   manifest;
7. remove only the temporary directories created by the script in a `finally`
   block.

The test must invoke the installed command path. Running
`node node_modules/forkneo/dist/index.js` would repeat the current blind spot.

The script will invoke the current npm CLI through `process.execPath` and
`process.env.npm_execpath`, passing every value as a separate argument.
`npm exec` performs the same platform-specific `.bin` resolution a package
consumer receives without requiring the smoke script to construct a shell
command. No user input is interpolated into the command.

### Package scripts and CI

Expose the smoke test as a named npm script with an npm `pretest:package`
hook that builds the current source first. The existing direct-file smoke may
remain as a fast diagnostic, but it is not accepted as package verification.

Every existing CI matrix entry will therefore validate:

```text
npm ci
npm test
npm run typecheck
npm run test:package
```

`npm run test:package` runs the production build before packing and installing
the artifact. This gives the package boundary the same Node 22/24/26 and
Ubuntu/macOS/Windows coverage as the rest of ForkNeo.

### Documentation

Update the development verification commands to include the installed-package
smoke test. Do not document `npm install -g forkneo` until an actual registry
publication exists.

## Testing Strategy

### Predicate unit tests

- direct canonical path returns `true`;
- a symlink to the module file returns `true` where file symlinks are
  available;
- a different existing file returns `false`;
- missing argv returns `false`;
- an unresolvable path returns `false`.

Symlink-specific unit coverage may be skipped only when the operating system
refuses file-symlink creation. The installed-package smoke test remains
mandatory on every CI platform and supplies the real package-manager behavior.

### Package regression test

The test is successful only when it:

- builds the current source;
- packs the exact package under test;
- installs the tarball in isolation;
- executes the installed `.bin` command;
- observes non-empty help output and exact version output.

The v0.3.0 baseline is the RED evidence: both installed commands currently
return zero with empty output. The corrected branch must turn the same
procedure GREEN.

### Full verification

Before delivery:

- all unit tests pass;
- type checking passes;
- the production bundle builds;
- direct `dist/index.js` help still works;
- the installed-package smoke test passes;
- `npm pack --dry-run` contains only intended package files;
- the complete GitHub Actions matrix passes.

## Delivery

The runtime correction, regression coverage, CI update, and matching
development documentation form one engineering unit and one pull request.
They must not be split into multiple pull requests for activity counts.

After merge, a patch release can be prepared from the verified main branch.
GitHub Release creation and npm publication remain separate release actions;
npm publication cannot proceed until the user supplies a real 2FA-protected
npm identity.

## Success Criteria

- A tarball built from the corrected branch runs
  `node_modules/.bin/forkneo --help` with normal usage output.
- The same installed command prints the current package version for
  `--version` (`0.3.0` before separate patch-release metadata changes).
- Importing the built module does not start the CLI.
- Existing direct execution, tests, types, build, and command behavior remain
  unchanged.
- CI proves the installed command on every supported operating system and
  Node.js version.
