import type { Octokit } from "@octokit/rest";

import type {
  CreateRepositoryInput,
  GitHubService,
  RepositoryInfo,
} from "../types/index.js";
import { ForkNeoError } from "../utils/errors.js";
import type { RepositoryReference } from "../utils/names.js";
import type { RepositoryState } from "../utils/verify.js";

interface ApiRepository {
  name: string;
  full_name: string;
  owner: { login: string };
  fork: boolean;
  private: boolean;
  visibility?: string;
  archived: boolean;
  size: number;
  language: string | null;
  default_branch: string;
  pushed_at: string | null;
  license: { spdx_id: string | null } | null;
  description: string | null;
  clone_url: string;
  html_url: string;
  parent?: { full_name: string };
}

function mapRepository(repository: ApiRepository): RepositoryInfo {
  return {
    owner: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    isFork: repository.fork,
    isPrivate: repository.private,
    visibility: repository.visibility ?? (repository.private ? "private" : "public"),
    archived: repository.archived,
    size: repository.size,
    language: repository.language,
    defaultBranch: repository.default_branch,
    pushedAt: repository.pushed_at,
    license: repository.license?.spdx_id ?? null,
    description: repository.description,
    cloneUrl: repository.clone_url,
    htmlUrl: repository.html_url,
    parentFullName: repository.parent?.full_name ?? null,
  };
}

export class GitHubRepositoryService implements GitHubService {
  constructor(private readonly octokit: Octokit) {}

  async getCurrentUser(): Promise<string> {
    const response = await this.octokit.rest.users.getAuthenticated();
    return response.data.login;
  }

  async listForks(): Promise<RepositoryInfo[]> {
    const repositories = await this.octokit.paginate(
      this.octokit.rest.repos.listForAuthenticatedUser,
      { affiliation: "owner", per_page: 100 },
    );
    return (repositories as ApiRepository[])
      .filter((repository) => repository.fork)
      .map(mapRepository);
  }

  async getRepository(reference: RepositoryReference): Promise<RepositoryInfo> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: reference.owner,
        repo: reference.repo,
      });
      return mapRepository(response.data as ApiRepository);
    } catch (error) {
      throw new ForkNeoError(
        "REPOSITORY_NOT_FOUND",
        `Repository not found or inaccessible: ${reference.fullName}`,
        "Check the repository name and token permissions.",
        { cause: error },
      );
    }
  }

  async repositoryExists(reference: RepositoryReference): Promise<boolean> {
    try {
      await this.octokit.rest.repos.get({ owner: reference.owner, repo: reference.repo });
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return false;
      }
      throw error;
    }
  }

  async createRepository(input: CreateRepositoryInput): Promise<RepositoryInfo> {
    const response = await this.octokit.rest.repos.createForAuthenticatedUser({
      name: input.name,
      description: input.description,
      private: input.isPrivate,
      auto_init: false,
    });
    return mapRepository(response.data as ApiRepository);
  }

  async getRepositoryState(
    reference: RepositoryReference,
    defaultBranch: string,
  ): Promise<RepositoryState> {
    const [commit, branches, tags] = await Promise.all([
      this.octokit.rest.repos.getCommit({
        owner: reference.owner,
        repo: reference.repo,
        ref: defaultBranch,
      }),
      this.octokit.paginate(this.octokit.rest.repos.listBranches, {
        owner: reference.owner,
        repo: reference.repo,
        per_page: 100,
      }),
      this.octokit.paginate(this.octokit.rest.repos.listTags, {
        owner: reference.owner,
        repo: reference.repo,
        per_page: 100,
      }),
    ]);

    return {
      latestCommit: commit.data.sha,
      branches: (branches as Array<{ name: string }>).map(({ name }) => name),
      tags: (tags as Array<{ name: string }>).map(({ name }) => name),
    };
  }

  async setDefaultBranch(reference: RepositoryReference, branch: string): Promise<void> {
    await this.octokit.rest.repos.update({
      owner: reference.owner,
      repo: reference.repo,
      default_branch: branch,
    });
  }
}
