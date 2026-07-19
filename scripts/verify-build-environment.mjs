import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCurrentEnvironment } from './verify-environment.mjs';
import packageJson from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const verifyBundleEnvironment = ({ bundleText, expectedProjectRef, forbiddenProjectRefs }) => {
  const errors = [];
  const expectedUrl = `https://${expectedProjectRef}.supabase.co`;
  if (!bundleText.includes(expectedUrl)) errors.push(`构建产物缺少预期 Supabase URL：${expectedUrl}`);
  for (const projectRef of forbiddenProjectRefs.filter(Boolean)) {
    const forbiddenUrl = `https://${projectRef}.supabase.co`;
    if (bundleText.includes(forbiddenUrl)) errors.push(`构建产物包含禁止的 Supabase URL：${forbiddenUrl}`);
  }
  return errors;
};

export const verifyReleaseArtifacts = ({ headersText, manifest, expectedEnvironment, bundleText }) => {
  const errors = [];
  if (manifest?.schema !== 1) errors.push('version.json schema must be 1');
  if (manifest?.version !== packageJson.version) errors.push('version.json version must match package.json');
  if (manifest?.environment !== expectedEnvironment) errors.push('version.json environment does not match the release branch');
  if (!manifest?.buildId || !bundleText.includes(manifest.buildId)) errors.push('frontend bundle and version.json build ids do not match');
  if (!Number.isInteger(manifest?.databaseContract) || manifest.databaseContract < 1) errors.push('version.json database contract is invalid');
  if (!headersText.includes('/version.json') || !headersText.includes('no-store')) errors.push('version.json must disable edge and browser caching');
  if (!headersText.includes('/assets/*') || !headersText.includes('immutable')) errors.push('hashed assets must use immutable caching');
  return errors;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const environment = verifyCurrentEnvironment();
  if (environment.errors.length) {
    environment.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  const assetsDirectory = path.join(root, 'dist', 'assets');
  const bundleText = readdirSync(assetsDirectory)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => readFileSync(path.join(assetsDirectory, fileName), 'utf8'))
    .join('\n');
  const forbiddenProjectRef = environment.expectedEnvironment === 'development'
    ? environment.env.STOREHUB_PRODUCTION_SUPABASE_REF
    : environment.env.STOREHUB_DEVELOPMENT_SUPABASE_REF;
  const errors = verifyBundleEnvironment({
    bundleText,
    expectedProjectRef: environment.expectedProjectRef,
    forbiddenProjectRefs: [forbiddenProjectRef],
  });
  const manifestPath = path.join(root, 'dist', 'version.json');
  const headersPath = path.join(root, 'dist', '_headers');
  if (!existsSync(manifestPath)) errors.push('构建产物缺少 version.json。');
  if (!existsSync(headersPath)) errors.push('构建产物缺少 Cloudflare _headers。');
  if (existsSync(manifestPath) && existsSync(headersPath)) {
    errors.push(...verifyReleaseArtifacts({
      bundleText,
      expectedEnvironment: environment.expectedEnvironment,
      headersText: readFileSync(headersPath, 'utf8'),
      manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
    }));
  }
  if (errors.length) {
    console.error('StoreHub 构建产物环境检查失败：');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log(`构建产物环境检查通过：仅包含 ${environment.expectedEnvironment} Supabase URL。`);
}
