import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeSteps = [
  ['环境与 CLI Link 校验', ['scripts/verify-environment.mjs', '--require-linked']],
  ['Migration 安全检查', ['scripts/check-migration-safety.mjs']],
  ['远端 Migration 一致性检查', ['scripts/verify-remote-migrations.mjs']],
];
const pnpmSteps = [
  ['数据库结构与 RLS 静态检查', ['validate:supabase']],
  ['密钥安全扫描', ['audit:security']],
  ['类型检查', ['typecheck']],
  ['Lint', ['lint']],
  ['测试', ['test']],
  ['构建', ['build']],
];

const run = (command, args) => spawnSync(command, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

for (const [label, args] of nodeSteps) {
  console.log(`\n== ${label} ==`);
  const result = run(process.execPath, args);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const [label, args] of pnpmSteps) {
  console.log(`\n== ${label} ==`);
  const result = process.env.npm_execpath
    ? run(process.execPath, [process.env.npm_execpath, ...args])
    : run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nStoreHub 发布门禁全部通过。');
