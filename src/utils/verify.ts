export interface RepositoryState {
  defaultBranch: string;
  refs: Readonly<Record<string, string>>;
}

export interface RepositoryComparison {
  matches: boolean;
  differences: string[];
}

export function compareRepositoryState(
  source: RepositoryState,
  target: RepositoryState,
): RepositoryComparison {
  const differences: string[] = [];

  if (source.defaultBranch !== target.defaultBranch) {
    differences.push(
      `Default branch differs: source ${source.defaultBranch}, target ${target.defaultBranch}`,
    );
  }

  const refNames = [
    ...new Set([...Object.keys(source.refs), ...Object.keys(target.refs)]),
  ].sort();

  for (const refName of refNames) {
    const sourceSha = source.refs[refName];
    const targetSha = target.refs[refName];

    if (sourceSha === undefined && targetSha !== undefined) {
      differences.push(`Unexpected target ref ${refName} -> ${targetSha}`);
      continue;
    }
    if (sourceSha !== undefined && targetSha === undefined) {
      differences.push(`Missing target ref ${refName} -> ${sourceSha}`);
      continue;
    }
    if (sourceSha !== targetSha) {
      differences.push(
        `Ref object differs for ${refName}: source ${sourceSha}, target ${targetSha}`,
      );
    }
  }

  return {
    matches: differences.length === 0,
    differences,
  };
}
