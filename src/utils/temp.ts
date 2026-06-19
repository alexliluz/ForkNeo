import path from "node:path";

import fs from "fs-extra";

export async function withTempDirectory<T>(
  work: (directory: string) => Promise<T>,
): Promise<T> {
  const root = path.join(process.cwd(), ".forkneo", "tmp");
  await fs.ensureDir(root);
  const directory = await fs.mkdtemp(path.join(root, "migration-"));
  try {
    return await work(directory);
  } finally {
    await fs.remove(directory);
  }
}
