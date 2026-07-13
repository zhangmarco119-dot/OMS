import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(path.join(root, 'config/environment-policy.json'), 'utf8'));

export const parseEnvText = (text) => Object.fromEntries(text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))
  .map((line) => {
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    return [key, value];
  }));

const loadEnvFiles = (appEnvironment) => {
  const files = [
    '.env',
    '.env.local',
    `.env.${appEnvironment}`,
    `.env.${appEnvironment}.local`,
  ];
  return files.reduce((values, file) => {
    const fullPath = path.join(root, file);
    return existsSync(fullPath) ? { ...values, ...parseEnvText(readFileSync(fullPath, 'utf8')) } : values;
  }, {});
};

export const extractSupabaseProjectRef = (rawUrl) => {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const gitBranch = () => {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

export const resolveBranch = (env = process.env) => (
  env.CF_PAGES_BRANCH
  || env.GITHUB_HEAD_REF
  || env.GITHUB_REF_NAME
  || env.STOREHUB_GIT_BRANCH
  || gitBranch()
).trim();

export const validateEnvironment = ({ branch, env, linkedProjectRef = null, policyConfig = policy }) => {
  const errors = [];
  const expectedEnvironment = policyConfig.branches[branch];
  if (!expectedEnvironment) {
    errors.push(`分支“${branch || '未知'}”不在允许部署清单中，仅允许 manage-system 和 v2-development。`);
    return { errors, expectedEnvironment: null, expectedProjectRef: null, projectRef: null };
  }

  const productionRef = env.STOREHUB_PRODUCTION_SUPABASE_REF?.trim();
  const developmentRef = env.STOREHUB_DEVELOPMENT_SUPABASE_REF?.trim();
  const refPattern = /^[a-z0-9]{20}$/;
  const committedProductionRef = policyConfig.productionProjectRef;
  const committedDevelopmentRef = policyConfig.developmentProjectRef;
  const committedProductionKeyHash = policyConfig.productionAnonKeySha256;
  const committedDevelopmentKeyHash = policyConfig.developmentAnonKeySha256;
  const hashPattern = /^[a-f0-9]{64}$/;
  if (!refPattern.test(productionRef ?? '')) errors.push('缺少或无效的 STOREHUB_PRODUCTION_SUPABASE_REF。');
  if (!refPattern.test(developmentRef ?? '')) errors.push('缺少或无效的 STOREHUB_DEVELOPMENT_SUPABASE_REF。');
  if (!refPattern.test(committedDevelopmentRef ?? '')) errors.push('仓库尚未登记开发测试 Supabase Project Ref，请先更新 config/environment-policy.json。');
  if (!hashPattern.test(committedProductionKeyHash ?? '')) errors.push('仓库缺少有效的正式 Anon Key 指纹。');
  if (!hashPattern.test(committedDevelopmentKeyHash ?? '')) errors.push('仓库尚未登记开发测试 Anon Key 指纹，请先更新 config/environment-policy.json。');
  if (productionRef && productionRef !== committedProductionRef) errors.push('正式项目编号与仓库安全策略不一致。');
  if (developmentRef && refPattern.test(committedDevelopmentRef ?? '') && developmentRef !== committedDevelopmentRef) errors.push('开发测试项目编号与仓库安全策略不一致。');
  if (productionRef && developmentRef && productionRef === developmentRef) errors.push('开发和正式 Supabase 项目编号必须不同。');
  if (refPattern.test(committedDevelopmentRef ?? '') && committedProductionRef === committedDevelopmentRef) errors.push('仓库登记的开发和正式 Supabase 项目编号必须不同。');
  if (hashPattern.test(committedDevelopmentKeyHash ?? '') && committedProductionKeyHash === committedDevelopmentKeyHash) errors.push('开发和正式 Supabase Anon Key 必须不同。');

  if (env.VITE_APP_ENV !== expectedEnvironment) {
    errors.push(`${branch} 必须设置 VITE_APP_ENV=${expectedEnvironment}。`);
  }

  const projectRef = extractSupabaseProjectRef(env.VITE_SUPABASE_URL ?? '');
  if (!projectRef) errors.push('VITE_SUPABASE_URL 必须是有效的 https://<project-ref>.supabase.co 地址。');
  const expectedProjectRef = expectedEnvironment === 'production'
    ? committedProductionRef
    : (refPattern.test(committedDevelopmentRef ?? '') ? committedDevelopmentRef : null);
  if (projectRef && expectedProjectRef && projectRef !== expectedProjectRef) {
    errors.push(`${branch} 当前 Supabase URL 与其指定的${expectedEnvironment === 'production' ? '正式' : '开发'}项目不一致。`);
  }
  if (branch === 'v2-development' && projectRef && projectRef === committedProductionRef) {
    errors.push('禁止 v2-development 连接正式 Supabase。');
  }
  if (branch === 'manage-system' && projectRef && refPattern.test(committedDevelopmentRef ?? '') && projectRef === committedDevelopmentRef) {
    errors.push('禁止 manage-system 连接开发测试 Supabase。');
  }

  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!anonKey || /your-|replace|placeholder/i.test(anonKey)) errors.push('缺少有效的 VITE_SUPABASE_ANON_KEY。');
  if (/service[_-]?role|sb_secret_/i.test(anonKey)) errors.push('前端禁止使用 service role 或 secret key。');
  const anonKeyHash = anonKey ? createHash('sha256').update(anonKey).digest('hex') : null;
  const expectedKeyHash = expectedEnvironment === 'production'
    ? committedProductionKeyHash
    : (hashPattern.test(committedDevelopmentKeyHash ?? '') ? committedDevelopmentKeyHash : null);
  if (anonKeyHash && expectedKeyHash && anonKeyHash !== expectedKeyHash) errors.push('Anon Key 指纹与当前分支指定的 Supabase 项目不一致。');
  const payload = decodeJwtPayload(anonKey);
  if (payload?.role && payload.role !== 'anon') errors.push('VITE_SUPABASE_ANON_KEY 的 JWT role 必须为 anon。');
  if (payload?.ref && projectRef && payload.ref !== projectRef) errors.push('Anon Key 所属项目与 Supabase URL 不一致。');

  if (linkedProjectRef && expectedProjectRef && linkedProjectRef !== expectedProjectRef) {
    errors.push('Supabase CLI 当前链接项目与此分支指定环境不一致，请先执行安全 Link。');
  }

  return { errors, expectedEnvironment, expectedProjectRef, projectRef };
};

export const verifyCurrentEnvironment = ({ requireLinked = false } = {}) => {
  const branch = resolveBranch();
  const expectedEnvironment = policy.branches[branch];
  const fileEnv = loadEnvFiles(expectedEnvironment ?? 'development');
  const env = { ...fileEnv, ...process.env };
  const linkedPath = path.join(root, 'supabase/.temp/project-ref');
  const linkedProjectRef = requireLinked && existsSync(linkedPath)
    ? readFileSync(linkedPath, 'utf8').trim()
    : null;
  const result = validateEnvironment({ branch, env, linkedProjectRef });
  if (requireLinked && !existsSync(linkedPath)) result.errors.push('Supabase CLI 尚未链接任何项目。');
  return { ...result, branch, env };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const requireLinked = process.argv.includes('--require-linked');
  const printProjectRef = process.argv.includes('--print-project-ref');
  const printAnonKeyFingerprint = process.argv.includes('--print-anon-key-fingerprint');
  const result = verifyCurrentEnvironment({ requireLinked });
  if (printAnonKeyFingerprint) {
    const anonKey = result.env.VITE_SUPABASE_ANON_KEY?.trim();
    if (!anonKey) {
      console.error('当前环境没有 VITE_SUPABASE_ANON_KEY。');
      process.exit(1);
    }
    console.log(createHash('sha256').update(anonKey).digest('hex'));
    process.exit(0);
  }
  if (result.errors.length) {
    console.error('StoreHub 环境校验失败：');
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  if (printProjectRef) console.log(result.expectedProjectRef);
  else console.log(`StoreHub 环境校验通过：${result.branch} -> ${result.expectedEnvironment} (${result.expectedProjectRef})`);
}
