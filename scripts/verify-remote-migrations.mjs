import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { verifyCurrentEnvironment } from './verify-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const runPnpm = (args) => {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      timeout: 120000,
    });
  }
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 120000,
  });
};

export const compareMigrationRows = (rows) => rows.flatMap((row) => {
  if (!row.local) return [`远端存在本地缺失的 Migration：${row.remote}`];
  if (!row.remote) return [`Migration ${row.local} 尚未应用到当前 Supabase`];
  if (row.local !== row.remote) return [`Migration 状态不一致：local=${row.local}, remote=${row.remote}`];
  return [];
});

export const compareMigrationVersions = (localVersions, remoteRows) => {
  if (!Array.isArray(remoteRows) || !remoteRows.length || remoteRows.some(row => typeof row.version !== 'string' || !/^\d+$/.test(row.version))) {
    throw new Error('远端 Migration 版本响应无效，不能跳过校验。');
  }
  const remoteVersions = remoteRows.map(row => row.version);
  if (new Set(remoteVersions).size !== remoteVersions.length) throw new Error('远端 Migration 版本重复。');
  const versions = [...new Set([...localVersions, ...remoteVersions])].sort();
  return compareMigrationRows(versions.map(version => ({local:localVersions.includes(version) ? version : null, remote:remoteVersions.includes(version) ? version : null})));
};

export const cloudMigrationCommand = (config, environment) => {
  if (config.projectRef !== environment.expectedProjectRef
    || config.container !== `supabase_db_storehub-local-${environment.expectedEnvironment}`
    || !/^[a-zA-Z0-9.-]+$/.test(config.host ?? '') || !/^[a-z_][a-z0-9_-]*$/.test(config.user ?? '')
    || !path.isAbsolute(config.identityFile ?? '') || !path.isAbsolute(config.knownHostsFile ?? '')) throw new Error('云端 Migration 校验配置与当前环境不匹配。');
  return ['-i',config.identityFile,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${config.knownHostsFile}`,`${config.user}@${config.host}`,
    `sudo docker exec -i ${config.container} psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1`];
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const environment = verifyCurrentEnvironment({ requireLinked: true });
  if (environment.errors.length) {
    console.error('远端 Migration 检查前的环境校验失败：');
    environment.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  const configPath = process.env.STOREHUB_MIGRATION_CHECK_CONFIG;
  const result = configPath ? spawnSync('ssh',cloudMigrationCommand(JSON.parse(readFileSync(configPath,'utf8')), environment), {
    cwd:root,encoding:'utf8',env:process.env,timeout:30000,
    input:"begin read only; select json_agg(json_build_object('version',version) order by version) from supabase_migrations.schema_migrations; rollback;"
  }) : runPnpm([
    'exec',
    'supabase',
    'db',
    'query',
    '--linked',
    '--output',
    'json',
    '--agent',
    'no',
    'select version from supabase_migrations.schema_migrations order by version',
  ]);
  // Management API avoids direct PostgreSQL connections that can be blocked
  // while still reading the actual linked project's migration history.
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { /* Report CLI failure below. */ }
  if (!payload) {
    process.stderr.write(result.stderr || result.stdout || 'Supabase CLI 执行失败。\n');
    process.exit(result.status ?? 1);
  }

  try {
    const localVersions = readdirSync(path.join(root,'supabase/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).map(name => name.match(/^(\d+)_/)[1]);
    const errors = compareMigrationVersions(localVersions,payload);
    if (errors.length) {
      console.error('远端 Migration 状态检查失败：');
      errors.forEach((error) => console.error(`- ${error}`));
      process.exit(1);
    }
    console.log(`远端 Migration 状态一致：${payload.length} 个版本，项目 ${environment.expectedProjectRef}（只读管理接口）。`);
  } catch (error) {
    console.error(`无法解析 Supabase Migration 状态：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
