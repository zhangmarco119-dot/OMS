import { describe, expect, it } from 'vitest';

import { compareMigrationRows, compareMigrationVersions } from './verify-remote-migrations.mjs';

describe('remote migration comparison', () => {
  it('compares actual management-API history without accepting empty or malformed responses', () => {
    expect(compareMigrationVersions(['0001','0002'],[{version:'0002'},{version:'0001'}])).toEqual([]);
    expect(compareMigrationVersions(['0001','0002'],[{version:'0001'}])).toEqual(['Migration 0002 尚未应用到当前 Supabase']);
    expect(()=>compareMigrationVersions(['0001'],[])).toThrow();
    expect(()=>compareMigrationVersions(['0001'],[{version:'invalid'}])).toThrow();
    expect(()=>compareMigrationVersions(['0001'],[{version:'0001'},{version:'0001'}])).toThrow();
  });
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
