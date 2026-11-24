// @vitest-environment node
import { Buffer } from 'node:buffer';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots = [];
const createRoot = () => { const root = mkdtempSync(path.join(tmpdir(), 'storehub-retention-')); roots.push(root); return root; };
const snapshot = (root, day, bytes = 100, completed = true) => {
  const name = `202611${String(day).padStart(2, '0')}T200000Z`;
  const directory = path.join(root, name); mkdirSync(directory);
  writeFileSync(path.join(directory, 'database.dump'), 'historical payroll and attendance');
  writeFileSync(path.join(directory, 'storage.tar.gz'), Buffer.alloc(bytes));
  if (completed) writeFileSync(path.join(directory, 'checksums.sha256'), 'checksums');
  return { name, directory };
};
const run = (root, args = []) => {
  const result = spawnSync('python', ['ops/maintain-backups.py', '--root', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Retention failed');
  return JSON.parse(result.stdout);
};
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

describe('StoreHub backup retention', () => {
  it('plans without deleting and preserves the baseline plus seven recent full copies', () => {
    const root = createRoot(); const backups = Array.from({ length: 12 }, (_, i) => snapshot(root, i + 1));
    const result = run(root);
    expect(result.retainedFull).toEqual([backups[0].name, ...backups.slice(-7).map((b) => b.name)]);
    expect(result.removeStorage).toHaveLength(4);
    expect(backups.every((b) => existsSync(path.join(b.directory, 'storage.tar.gz')))).toBe(true);
  });

  it('removes only superseded photo copies and keeps all recent database dumps', () => {
    const root = createRoot(); const backups = Array.from({ length: 10 }, (_, i) => snapshot(root, i + 1));
    run(root, ['--apply']);
    expect(existsSync(path.join(backups[1].directory, 'storage.tar.gz'))).toBe(false);
    expect(existsSync(path.join(backups[1].directory, 'storage-pruned.json'))).toBe(true);
    expect(backups.every((b) => existsSync(path.join(b.directory, 'database.dump')))).toBe(true);
  });

  it('bounds bytes while preserving at least two recent recovery copies and the baseline', () => {
    const root = createRoot(); const backups = Array.from({ length: 8 }, (_, i) => snapshot(root, i + 1));
    expect(run(root, ['--budget-bytes', '250']).retainedFull).toEqual([backups[0].name, backups[6].name, backups[7].name]);
  });

  it('keeps incomplete jobs and unrelated directories untouched', () => {
    const root = createRoot(); const partial = snapshot(root, 1, 100, false);
    mkdirSync(path.join(root, 'business-files')); writeFileSync(path.join(root, 'business-files', 'storage.tar.gz'), 'keep');
    for (let i = 2; i <= 12; i++) snapshot(root, i);
    run(root, ['--apply']);
    expect(existsSync(path.join(partial.directory, 'storage.tar.gz'))).toBe(true);
    expect(existsSync(path.join(root, 'business-files', 'storage.tar.gz'))).toBe(true);
  });

  it('bounds database snapshots while keeping the original baseline', () => {
    const root = createRoot(); const backups = Array.from({ length: 12 }, (_, i) => snapshot(root, i + 1));
    const result = run(root, ['--keep-database', '8', '--apply']);
    expect(result.removeDirectories).toEqual(backups.slice(1, 4).map((b) => b.name));
    expect(existsSync(backups[0].directory)).toBe(true);
    expect(existsSync(backups[1].directory)).toBe(false);
  });
});
