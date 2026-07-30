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

function createNonInteractiveChildEnv(
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnv = { ...baseEnv };
  for (const key of Object.keys(childEnv)) {
    if (
      /^(?:GIT|SSH)_ASKPASS$/i.test(key) ||
      /^GIT_CONFIG_(?:COUNT|PARAMETERS|KEY_\d+|VALUE_\d+)$/i.test(key)
    ) {
      delete childEnv[key];
    }
  }
  return childEnv;
}

export function createGitAuthentication(
  value: string,
  token: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): GitAuthentication {
  if (token.length === 0) {
    throw new ForkNeoError(
      "INVALID_GITHUB_TOKEN",
      "Authenticated Git operations require a non-empty GitHub token.",
      "Set a non-empty GitHub token before retrying.",
    );
  }

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

  if (
    url.protocol !== "https:" ||
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ForkNeoError(
      "UNSUPPORTED_GIT_TRANSPORT",
      "Authenticated Git operations require a credential-free URL on the official GitHub HTTPS origin.",
      "Use a credential-free https://github.com repository clone URL.",
    );
  }

  const repositoryUrl = url.toString();
  const basicCredential = Buffer.from(
    `x-access-token:${token}`,
    "utf8",
  ).toString("base64");
  const authorizationHeader = `Authorization: Basic ${basicCredential}`;
  const childEnv = createNonInteractiveChildEnv(baseEnv);

  return {
    url: repositoryUrl,
    env: {
      ...childEnv,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "4",
      GIT_CONFIG_KEY_0: `http.${repositoryUrl}.extraHeader`,
      GIT_CONFIG_VALUE_0: authorizationHeader,
      GIT_CONFIG_KEY_1: "credential.interactive",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_KEY_2: "credential.helper",
      GIT_CONFIG_VALUE_2: "",
      GIT_CONFIG_KEY_3: "core.askPass",
      GIT_CONFIG_VALUE_3: "",
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
