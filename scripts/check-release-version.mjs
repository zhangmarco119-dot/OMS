import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const parseDisplayedVersion = (source) => {
  const match = source.match(/version:\s*['"]StoreHub v(\d+)\.(\d+)\.(\d+)['"]/);
  if (!match) throw new Error('未找到有效的 StoreHub x.y.z 版本号。');
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    value: `${match[1]}.${match[2]}.${match[3]}`,
  };
};

export const validateVersionMetadata = (displayedVersion, packageVersion) => {
  if (displayedVersion.value !== packageVersion) {
    throw new Error(`界面版本 ${displayedVersion.value} 与 package.json 版本 ${packageVersion} 不一致。`);
  }
};

export const validateProductionMinorRelease = (previousVersion, currentVersion) => {
  if (currentVersion.major !== previousVersion.major) {
    throw new Error('正式合并不得在未明确调整发布策略时改变主版本号。');
  }
  if (currentVersion.minor !== previousVersion.minor + 1 || currentVersion.patch !== 0) {
    throw new Error(`正式合并必须把版本从 ${previousVersion.major}.${previousVersion.minor}.x 提升为 ${previousVersion.major}.${previousVersion.minor + 1}.0。`);
  }
};

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const resolveBranch = () => (
  process.env.CF_PAGES_BRANCH
  || process.env.GITHUB_HEAD_REF
  || process.env.GITHUB_REF_NAME
  || process.env.STOREHUB_GIT_BRANCH
  || git('branch', '--show-current')
).trim();

export const verifyReleaseVersion = () => {
  const versionSource = readFileSync(path.join(root, 'src/config/version.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const currentVersion = parseDisplayedVersion(versionSource);
  validateVersionMetadata(currentVersion, packageJson.version);

  const branch = resolveBranch();
  if (branch === 'manage-system') {
    const commitAndParents = git('rev-list', '--parents', '-n', '1', 'HEAD').split(/\s+/);
    if (commitAndParents.length < 3) {
      throw new Error('manage-system 的正式发布提交必须是合并提交。');
    }
    const previousProductionCommit = commitAndParents[1];
    const previousSource = git('show', `${previousProductionCommit}:src/config/version.ts`);
    const previousVersion = parseDisplayedVersion(previousSource);
    validateProductionMinorRelease(previousVersion, currentVersion);
    console.log(`正式版本规则校验通过：${previousVersion.value} -> ${currentVersion.value}。`);
    return;
  }

  console.log(`版本元数据校验通过：${branch} 使用 ${currentVersion.value}。`);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    verifyReleaseVersion();
  } catch (error) {
    console.error(`StoreHub 版本规则校验失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
