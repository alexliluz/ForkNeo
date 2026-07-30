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
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
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
