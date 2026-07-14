import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const normalizePath = (filePath) => filePath.replaceAll('\\', '/');

export const inspectMigrationSql = (fileName, sql) => {
  const errors = [];
  const structuralSql = sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
  const destructivePatterns = [
    [/\btruncate\b/i, '禁止在发布 Migration 中使用 TRUNCATE'],
    [/\bdrop\s+(?:table|schema|database)\b/i, '禁止在发布 Migration 中删除表、Schema 或数据库'],
    [/\bdelete\s+from\b/i, '禁止在发布 Migration 中直接清理业务数据'],
  ];

  if (/(?:test|demo|sample).*(?:clean|clear|delete)|(?:clean|clear|delete).*(?:test|demo|sample)/i.test(fileName)) {
    errors.push('Migration 文件名疑似测试数据清理脚本');
  }
  for (const [pattern, message] of destructivePatterns) {
    if (pattern.test(structuralSql)) errors.push(message);
  }
  return errors;
};

export const validateMigrationChanges = ({ changes, readSql, baseMigrationNames }) => {
  const errors = [];
  const newMigrations = [];
  const baseNumbers = baseMigrationNames
    .map((name) => Number(name.match(/^(\d{4})_/)?.[1]))
    .filter(Number.isFinite);
  const highestBaseNumber = baseNumbers.length ? Math.max(...baseNumbers) : 0;

  for (const change of changes) {
    const status = change.status[0];
    const file = normalizePath(change.file);
    if (!file.startsWith('supabase/migrations/') || !file.endsWith('.sql')) continue;
    if (status !== 'A') {
      errors.push(`${file}: 已存在的 Migration 不得修改、删除或重命名，只能新增文件`);
      continue;
    }
    const fileName = path.posix.basename(file);
    const match = fileName.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
    if (!match) {
      errors.push(`${file}: 文件名必须使用 4 位递增编号和小写下划线名称`);
      continue;
    }
    const number = Number(match[1]);
    if (number <= highestBaseNumber) {
      errors.push(`${file}: 新 Migration 编号必须大于现有最大编号 ${String(highestBaseNumber).padStart(4, '0')}`);
    }
    const sqlErrors = inspectMigrationSql(fileName, readSql(file));
    errors.push(...sqlErrors.map((message) => `${file}: ${message}`));
    newMigrations.push(file);
  }

  const numbers = newMigrations.map((file) => path.posix.basename(file).slice(0, 4));
  for (const number of new Set(numbers)) {
    if (numbers.filter((value) => value === number).length > 1) {
      errors.push(`新增 Migration 编号 ${number} 重复`);
    }
  }

  return { errors, newMigrations };
};

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const defaultBase = () => {
  const branch = git(['branch', '--show-current']);
  if (branch === 'v2-development') return 'manage-system';
  if (branch === 'manage-system') return 'origin/manage-system';
  throw new Error(`不允许从分支“${branch || '未知'}”执行发布检查`);
};

const readChanges = (base) => {
  const output = git(['diff', '--name-status', '--find-renames', base, '--']);
  const trackedChanges = output ? output.split(/\r?\n/).map((line) => {
    const [status, firstPath, secondPath] = line.split('\t');
    return { status, file: secondPath ?? firstPath };
  }) : [];
  const untrackedOutput = git(['ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations']);
  const knownFiles = new Set(trackedChanges.map((change) => normalizePath(change.file)));
  const untrackedChanges = untrackedOutput
    ? untrackedOutput.split(/\r?\n/)
      .filter((file) => !knownFiles.has(normalizePath(file)))
      .map((file) => ({ status: 'A', file }))
    : [];
  return [...trackedChanges, ...untrackedChanges];
};

const readBaseMigrationNames = (base) => {
  const output = git(['ls-tree', '-r', '--name-only', base, '--', 'supabase/migrations']);
  return output ? output.split(/\r?\n/).map((file) => path.posix.basename(file)) : [];
};

export const checkCurrentMigrationSafety = ({ base } = {}) => {
  const comparisonBase = base || defaultBase();
  const result = validateMigrationChanges({
    changes: readChanges(comparisonBase),
    readSql: (file) => readFileSync(path.join(root, file), 'utf8'),
    baseMigrationNames: readBaseMigrationNames(comparisonBase),
  });

  if (existsSync(path.join(root, 'supabase', 'seed.sql'))) {
    result.errors.push('禁止保留 supabase/seed.sql；测试 Seed 只能放在 supabase/seeds/development.sql');
  }
  const seedsDirectory = path.join(root, 'supabase', 'seeds');
  if (existsSync(seedsDirectory)) {
    for (const fileName of readdirSync(seedsDirectory)) {
      if (fileName !== 'development.sql') result.errors.push(`supabase/seeds/${fileName}: 只允许 development.sql`);
    }
  }
  return { ...result, base: comparisonBase };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const baseIndex = process.argv.indexOf('--base');
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
  try {
    const result = checkCurrentMigrationSafety({ base });
    if (result.errors.length) {
      console.error('Migration 安全检查失败：');
      result.errors.forEach((error) => console.error(`- ${error}`));
      process.exit(1);
    }
    console.log(`Migration 安全检查通过：基线 ${result.base}，新增 ${result.newMigrations.length} 个 Migration。`);
  } catch (error) {
    console.error(`Migration 安全检查无法完成：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
