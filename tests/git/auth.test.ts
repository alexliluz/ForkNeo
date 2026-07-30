import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  createGitAuthentication,
  redactGitSecrets,
} from "../../src/git/auth.js";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createSentinelCommand(
  directory: string,
  name: string,
  markerPath: string,
): Promise<string> {
  const isWindows = process.platform === "win32";
  const commandPath = path.join(directory, `${name}${isWindows ? ".cmd" : ""}`);
  const contents = isWindows
    ? `@echo invoked>>"${markerPath}"\r\n@exit /b 0\r\n`
    : `#!/bin/sh\nprintf invoked >> '${markerPath.replaceAll("'", "'\"'\"'")}'\n`;

  await fs.writeFile(commandPath, contents, "utf8");
  if (!isWindows) {
    await fs.chmod(commandPath, 0o755);
  }
  return commandPath;
}

describe("createGitAuthentication", () => {
  it("rejects an empty GitHub token", () => {
    const failure = (() => {
      try {
        createGitAuthentication("https://github.com/alex/project.git", "");
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toMatchObject({ code: "INVALID_GITHUB_TOKEN" });
  });

  it("scopes a child-only authorization header to the exact HTTPS URL", () => {
    const baseEnv = {
      PATH: "/usr/bin",
      KEEP_ME: "yes",
      GIT_ASKPASS: "/ambient/git-askpass",
      git_askpass: "/ambient/lowercase-git-askpass",
      SSH_ASKPASS: "/ambient/ssh-askpass",
      ssh_askpass: "/ambient/lowercase-ssh-askpass",
      GIT_CONFIG_PARAMETERS: "'credential.helper=ambient-helper'",
      GIT_CONFIG_COUNT: "8",
      GIT_CONFIG_KEY_7: "core.askPass",
      GIT_CONFIG_VALUE_7: "/ambient/config-askpass",
    };
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
    });
    expect(authentication.env.GIT_CONFIG_COUNT).toBe("4");
    expect(
      Array.from({ length: 4 }, (_, index) => [
        authentication.env[`GIT_CONFIG_KEY_${index}`],
        authentication.env[`GIT_CONFIG_VALUE_${index}`],
      ]),
    ).toEqual([
      [
        "http.https://github.com/alex/project.git.extraHeader",
        expect.stringMatching(/^Authorization: Basic /),
      ],
      ["credential.interactive", "false"],
      ["credential.helper", ""],
      ["core.askPass", ""],
    ]);
    expect(authentication.env.GIT_CONFIG_VALUE_0).toMatch(
      /^Authorization: Basic /,
    );
    expect(
      Object.keys(authentication.env).filter((key) =>
        /^(?:GIT|SSH)_ASKPASS$/i.test(key),
      ),
    ).toEqual([]);
    expect(authentication.env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(authentication.env.GIT_CONFIG_KEY_7).toBeUndefined();
    expect(authentication.env.GIT_CONFIG_VALUE_7).toBeUndefined();
    expect(baseEnv).toEqual({
      PATH: "/usr/bin",
      KEEP_ME: "yes",
      GIT_ASKPASS: "/ambient/git-askpass",
      git_askpass: "/ambient/lowercase-git-askpass",
      SSH_ASKPASS: "/ambient/ssh-askpass",
      ssh_askpass: "/ambient/lowercase-ssh-askpass",
      GIT_CONFIG_PARAMETERS: "'credential.helper=ambient-helper'",
      GIT_CONFIG_COUNT: "8",
      GIT_CONFIG_KEY_7: "core.askPass",
      GIT_CONFIG_VALUE_7: "/ambient/config-askpass",
    });
  });

  it("rejects an arbitrary HTTPS host without echoing URL text", () => {
    const url = "https://attacker.example/private/project.git";
    const failure = (() => {
      try {
        createGitAuthentication(url, "secret");
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toMatchObject({ code: "UNSUPPORTED_GIT_TRANSPORT" });
    expect(String(failure)).not.toContain("attacker.example");
    expect(String(failure)).not.toContain("/private/project.git");
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

  it.each([
    [
      "https://github.com/alex/project.git?access_token=query-token",
      "query-token",
    ],
    ["https://github.com/alex/project.git#fragment-token", "fragment-token"],
  ])(
    "rejects URLs with credentials in their query or fragment: %s",
    (url, token) => {
      let authentication:
        | ReturnType<typeof createGitAuthentication>
        | undefined;
      const failure = (() => {
        try {
          authentication = createGitAuthentication(url, "github-token");
          return undefined;
        } catch (error) {
          return error;
        }
      })();

      expect(failure).toMatchObject({ code: "UNSUPPORTED_GIT_TRANSPORT" });
      expect(String(failure)).not.toContain(token);
      expect(String(failure)).not.toContain(url);
      expect(authentication).toBeUndefined();
      expect(authentication?.url ?? "").not.toContain(token);
      expect(authentication?.env.GIT_CONFIG_KEY_0 ?? "").not.toContain(token);
    },
  );

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

  it("prevents ambient Git helpers and askpass without persisting config", async () => {
    const scratchRoot = path.join(process.cwd(), ".tmp");
    await fs.mkdir(scratchRoot, { recursive: true });
    const directory = await fs.mkdtemp(
      path.join(scratchRoot, "credential-fallback-"),
    );
    scratchDirectories.push(directory);

    const markerPath = path.join(directory, "sentinel-invoked");
    await createSentinelCommand(
      directory,
      "git-credential-sentinel",
      markerPath,
    );
    const askpassPath = await createSentinelCommand(
      directory,
      "askpass-sentinel",
      markerPath,
    );
    const globalConfigPath = path.join(directory, "global.gitconfig");
    const isolatedEnv = {
      ...process.env,
      HOME: directory,
      USERPROFILE: directory,
      XDG_CONFIG_HOME: directory,
      GIT_CONFIG_GLOBAL: globalConfigPath,
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
    };

    await execa(
      "git",
      ["config", "--file", globalConfigPath, "credential.helper", "sentinel"],
      { env: isolatedEnv },
    );
    await execa(
      "git",
      ["config", "--file", globalConfigPath, "core.askPass", askpassPath],
      { env: isolatedEnv },
    );
    const persistedConfigBefore = await fs.readFile(globalConfigPath, "utf8");
    const baseEnv = {
      ...isolatedEnv,
      GIT_ASKPASS: askpassPath,
      SSH_ASKPASS: askpassPath,
      GIT_CONFIG_PARAMETERS: "'credential.helper=sentinel'",
    };
    const authentication = createGitAuthentication(
      "https://github.com/alex/project.git",
      "rejected-token",
      baseEnv,
    );

    const result = await execa("git", ["credential", "fill"], {
      env: authentication.env,
      input: "protocol=https\nhost=github.com\n\n",
      reject: false,
      timeout: 10_000,
    });

    expect(result.exitCode).not.toBe(0);
    await expect(fs.access(markerPath)).rejects.toThrow();
    await expect(fs.readFile(globalConfigPath, "utf8")).resolves.toBe(
      persistedConfigBefore,
    );
    expect(baseEnv.GIT_ASKPASS).toBe(askpassPath);
    expect(baseEnv.SSH_ASKPASS).toBe(askpassPath);
    expect(baseEnv.GIT_CONFIG_PARAMETERS).toBe(
      "'credential.helper=sentinel'",
    );
  });
});
