import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("Run the installed-package smoke test through npm.");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} exited with status ${result.status}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result.stdout.trim();
}

function runNpm(args, cwd) {
  return run(process.execPath, [npmCli, ...args], cwd);
}

const workspace = await mkdtemp(join(tmpdir(), "forkneo-package-smoke-"));
const packDirectory = join(workspace, "pack");
const installDirectory = join(workspace, "install");

try {
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(installDirectory, { recursive: true }),
  ]);

  const packResult = JSON.parse(
    runNpm(
      ["pack", "--json", "--pack-destination", packDirectory],
      packageRoot,
    ),
  );
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error("npm pack did not return exactly one package.");
  }

  const tarball = join(packDirectory, packResult[0].filename);
  const packagedFiles = packResult[0].files.map(({ path }) => path);
  if (!packagedFiles.includes("dist/index.js")) {
    throw new Error("Packed artifact is missing dist/index.js.");
  }

  runNpm(
    [
      "install",
      "--prefix",
      installDirectory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    workspace,
  );

  const installedBin = join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "forkneo.cmd" : "forkneo",
  );
  await access(installedBin);

  const help = runNpm(
    [
      "exec",
      "--prefix",
      installDirectory,
      "--offline",
      "--",
      "forkneo",
      "--help",
    ],
    workspace,
  );
  if (!help.includes("Usage: forkneo [options] [command]")) {
    throw new Error("Installed forkneo --help did not print CLI usage.");
  }

  const version = runNpm(
    [
      "exec",
      "--prefix",
      installDirectory,
      "--offline",
      "--",
      "forkneo",
      "--version",
    ],
    workspace,
  );
  if (version !== packageMetadata.version) {
    throw new Error(
      `Installed version ${JSON.stringify(version)} does not match ` +
        `${JSON.stringify(packageMetadata.version)}.`,
    );
  }

  console.log(
    `Installed forkneo ${version} passed help and version smoke tests.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
