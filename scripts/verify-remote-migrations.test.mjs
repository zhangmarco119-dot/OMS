import { describe, expect, it } from 'vitest';

import { compareMigrationRows } from './verify-remote-migrations.mjs';

describe('remote migration comparison', () => {
  it('accepts matching local and remote versions', () => {
    expect(compareMigrationRows([{ local: '0037', remote: '0037' }])).toEqual([]);
  });

  it('rejects pending and remote-only versions', () => {
    expect(compareMigrationRows([
      { local: '0038', remote: null },
      { local: null, remote: '0039' },
    ])).toEqual([
      'Migration 0038 尚未应用到当前 Supabase',
      '远端存在本地缺失的 Migration：0039',
    ]);
  });
});
