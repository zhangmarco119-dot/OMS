import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  '.agents',
  '.codex',
  '.codex-remote-attachments',
  '.tmp',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'reference',
  '.temp',
]);
const ignoredFiles = new Set([
  '.env',
  '.env.local',
  'security-check.mjs',
]);
const scannedExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.sql',
  '.ts',
  '.tsx',
  '.yml',
  '.yaml',
]);

const forbiddenPatterns = [
  {
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=/i,
    reason: 'service role key must not be committed',
  },
  {
    pattern: /service_role[_-]?[a-z0-9]{20,}/i,
    reason: 'possible Supabase service role secret',
  },
  {
    pattern: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
    reason: 'database connection string with password',
  },
  {
    pattern: /sb_secret_[a-z0-9_-]{20,}/i,
    reason: 'possible Supabase secret key',
  },
  {
    pattern: /sb_publishable_[a-z0-9_-]{20,}/i,
    reason: 'real Supabase publishable key must stay outside Git',
  },
  {
    pattern: /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\.[a-z0-9_-]{20,}\b/i,
    reason: 'possible committed JWT/legacy anon key',
  },
  {
    pattern: /SUPABASE_ACCESS_TOKEN\s*=\s*\S+/i,
    reason: 'Supabase access token must not be committed',
  },
  {
    pattern: /\bsk-[a-f0-9]{32}\b/i,
    reason: 'possible committed DeepSeek API key',
  },
  {
    pattern: /(?:appId|appID)\s*[:=]\s*['"][a-f0-9]{32}['"]/i,
    reason: 'possible committed POS application id',
  },
  {
    pattern: /appKey\s*[:=]\s*['"][a-z0-9]{12,}['"]/i,
    reason: 'possible committed POS application key',
  },
];

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll(path.sep, '/');

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...await walk(fullPath));
      }
      continue;
    }

    if (ignoredFiles.has(entry.name)) {
      continue;
    }

    if (scannedExtensions.has(path.extname(entry.name))) {
      files.push({ fullPath, relativePath });
    }
  }

  return files;
};

const failures = [];
const files = await walk(root);

for (const file of files) {
  const content = await readFile(file.fullPath, 'utf8');
  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(content)) {
      failures.push(`${file.relativePath}: ${reason}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Security check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Security check passed: scanned ${files.length} files.`);
