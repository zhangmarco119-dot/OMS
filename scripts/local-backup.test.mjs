// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const removeTestDirectory = (root) => {
  if (!path.isAbsolute(root) || !path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'storehub-runner-')) throw new Error('Unsafe test cleanup path');
  rmSync(root, { recursive: true, force: true });
};

it('preserves recoverable local backups through interrupted transfers and retention', () => {
  const result = spawnSync('python', ['ops/test_local_backup.py'], { encoding: 'utf8' });
  expect(result.stderr || result.stdout).toContain('Ran 6 tests');
  expect(result.status, result.stderr).toBe(0);
});

it.skipIf(process.platform !== 'win32')('retries native stderr failures in the actual Windows startup runner', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'storehub-runner-'));
  try {
    mkdirSync(path.join(root, 'bin')); mkdirSync(path.join(root, 'config'));
    copyFileSync('ops/run-local-backup.ps1', path.join(root, 'bin', 'run-local-backup.ps1'));
    const python = spawnSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(root, 'config', 'backup.json'), JSON.stringify({ pythonExecutable: python }));
    writeFileSync(path.join(root, 'bin', 'local-backup.py'), [
      'import pathlib,sys',
      'p=pathlib.Path(__file__).parent.parent/"attempts.txt"',
      'n=int(p.read_text())+1 if p.exists() else 1',
      'p.write_text(str(n))',
      'print("temporary network failure",file=sys.stderr) if n==1 else print("backup complete")',
      'sys.exit(1 if n==1 else 0)',
    ].join('\n'));
    const result = spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'bin', 'run-local-backup.ps1'),
      '-RetryDelaySeconds', '0', '-MaxAttempts', '2',
    ], { encoding: 'utf8', timeout: 30000 });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(root, 'attempts.txt'), 'utf8')).toBe('2');
  } finally {
    removeTestDirectory(root);
  }
});
