export interface RepositoryState {
  latestCommit: string;
  branches: string[];
  tags: string[];
}

export interface RepositoryComparison {
  matches: boolean;
  differences: string[];
}

function setDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort();
}

export function compareRepositoryState(
  source: RepositoryState,
  target: RepositoryState,
): RepositoryComparison {
  const differences: string[] = [];

  if (source.latestCommit !== target.latestCommit) {
    differences.push(
      `Latest default-branch commit differs: source ${source.latestCommit}, target ${target.latestCommit}`,
    );
  }

  const missingBranches = setDifference(source.branches, target.branches);
  const extraBranches = setDifference(target.branches, source.branches);
  const missingTags = setDifference(source.tags, target.tags);
  const extraTags = setDifference(target.tags, source.tags);

  if (missingBranches.length) {
    differences.push(`Missing target branches: ${missingBranches.join(", ")}`);
  }
  if (extraBranches.length) {
    differences.push(`Extra target branches: ${extraBranches.join(", ")}`);
  }
  if (missingTags.length) {
    differences.push(`Missing target tags: ${missingTags.join(", ")}`);
  }
  if (extraTags.length) {
    differences.push(`Extra target tags: ${extraTags.join(", ")}`);
  }

  return { matches: differences.length === 0, differences };
}
