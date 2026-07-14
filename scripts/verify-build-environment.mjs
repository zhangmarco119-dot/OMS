import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCurrentEnvironment } from './verify-environment.mjs';

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
  if (errors.length) {
    console.error('StoreHub 构建产物环境检查失败：');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log(`构建产物环境检查通过：仅包含 ${environment.expectedEnvironment} Supabase URL。`);
}
