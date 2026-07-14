import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCurrentEnvironment } from './verify-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const runPnpm = (args) => {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
  }
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
};

export const compareMigrationRows = (rows) => rows.flatMap((row) => {
  if (!row.local) return [`远端存在本地缺失的 Migration：${row.remote}`];
  if (!row.remote) return [`Migration ${row.local} 尚未应用到当前 Supabase`];
  if (row.local !== row.remote) return [`Migration 状态不一致：local=${row.local}, remote=${row.remote}`];
  return [];
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const environment = verifyCurrentEnvironment({ requireLinked: true });
  if (environment.errors.length) {
    console.error('远端 Migration 检查前的环境校验失败：');
    environment.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  const result = runPnpm([
    'dlx',
    'supabase@latest',
    'migration',
    'list',
    '--linked',
    '--output-format',
    'json',
    '--agent',
    'no',
  ]);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'Supabase CLI 执行失败。\n');
    process.exit(result.status ?? 1);
  }

  try {
    const payload = JSON.parse(result.stdout);
    const errors = compareMigrationRows(payload.migrations ?? []);
    if (errors.length) {
      console.error('远端 Migration 状态检查失败：');
      errors.forEach((error) => console.error(`- ${error}`));
      process.exit(1);
    }
    console.log(`远端 Migration 状态一致：${payload.migrations?.length ?? 0} 个版本，项目 ${environment.expectedProjectRef}。`);
  } catch (error) {
    console.error(`无法解析 Supabase Migration 状态：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
