import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const functionEntrypoints = [
  'account-login/index.ts',
  'admin-users/index.ts',
  'task-template-images/index.ts',
  'dingtalk-attendance/index.ts',
  'pospal-sales/index.ts',
];

describe('Edge Function CORS headers', () => {
  it.each(functionEntrypoints)('%s permits StoreHub release headers in browser preflight requests', (entrypoint) => {
    const source = readFileSync(path.resolve('supabase/functions', entrypoint), 'utf8');
    const allowHeaders = source.match(/['"]Access-Control-Allow-Headers['"]\s*:\s*([\s\S]*?),\r?\n\s*['"]Access-Control-Allow-Methods['"]/)?.[1] ?? '';

    expect(allowHeaders).toContain('x-storehub-contract');
    expect(allowHeaders).toContain('x-storehub-release');
  });
});
