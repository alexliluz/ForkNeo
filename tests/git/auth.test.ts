import { describe, expect, it } from "vitest";

import {
  createGitAuthentication,
  redactGitSecrets,
} from "../../src/git/auth.js";

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
});
