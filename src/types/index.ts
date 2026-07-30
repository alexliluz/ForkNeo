import type { RepositoryReference } from "../utils/names.js";
import type { RepositoryState } from "../utils/verify.js";

export interface RepositoryInfo {
  owner: string;
  name: string;
  fullName: string;
  isFork: boolean;
  isPrivate: boolean;
  visibility: string;
  archived: boolean;
  size: number;
  language: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  license: string | null;
  description: string | null;
  cloneUrl: string;
  htmlUrl: string;
  parentFullName: string | null;
}

export interface CreateRepositoryInput {
  name: string;
  description?: string;
  isPrivate: boolean;
}

export interface GitHubService {
  getCurrentUser(): Promise<string>;
  listForks(): Promise<RepositoryInfo[]>;
  getRepository(reference: RepositoryReference): Promise<RepositoryInfo>;
  repositoryExists(reference: RepositoryReference): Promise<boolean>;
  createRepository(input: CreateRepositoryInput): Promise<RepositoryInfo>;
  getRepositoryState(
    reference: RepositoryReference,
  ): Promise<RepositoryState>;
  setDefaultBranch(reference: RepositoryReference, branch: string): Promise<void>;
}

export interface GitService {
  cloneMirror(sourceUrl: string, directory: string, token: string): Promise<void>;
  pruneUnsupportedRefs(directory: string): Promise<void>;
  pushMirror(directory: string, targetUrl: string, token: string): Promise<void>;
  hasLfs(directory: string): Promise<boolean>;
  fetchAllLfs(
    directory: string,
    sourceUrl: string,
    token: string,
  ): Promise<void>;
  pushAllLfs(directory: string, targetUrl: string, token: string): Promise<void>;
}
