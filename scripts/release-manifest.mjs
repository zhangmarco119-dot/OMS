import { execFileSync } from 'node:child_process';

const normalizeCommit = (value) => {
  const commit = String(value ?? '').trim();
  return /^[a-f0-9]{7,64}$/i.test(commit) ? commit.toLowerCase() : 'local';
};

export const createReleaseMetadata = ({ appEnvironment, commitSha, packageVersion }) => {
  const commit = normalizeCommit(commitSha);
  const environment = appEnvironment === 'production' ? 'production' : 'development';
  return {
    buildId: `${packageVersion}+${commit === 'local' ? 'local' : commit.slice(0, 12)}`,
    builtAt: new Date().toISOString(),
    databaseContract: 1,
    environment,
    version: packageVersion,
  };
};

export const resolveGitCommit = (cwd) => {
  const provided = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || process.env.STOREHUB_BUILD_SHA;
  if (provided) return normalizeCommit(provided);
  try {
    return normalizeCommit(execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }));
  } catch {
    return 'local';
  }
};

export const createReleaseManifest = (metadata) => ({
  ...metadata,
  schema: 1,
});
