import { describe, expect, it } from 'vitest';

import { compareMigrationRows, compareMigrationVersions, cloudMigrationCommand } from './verify-remote-migrations.mjs';

describe('remote migration comparison', () => {
  it('checks cloud history with pinned SSH hosts and rejects cross-environment targets', () => {
    const config={projectRef:'dev-ref',container:'supabase_db_storehub-local-development',host:'43.163.113.19',user:'ubuntu',identityFile:'/private/key',knownHostsFile:'/private/known_hosts'};
    const environment={expectedEnvironment:'development',expectedProjectRef:'dev-ref'};
    expect(cloudMigrationCommand(config,environment)).toContain('StrictHostKeyChecking=yes');
    expect(()=>cloudMigrationCommand({...config,container:'supabase_db_storehub-local-production'},environment)).toThrow();
    expect(()=>cloudMigrationCommand({...config,host:'host;unsafe'},environment)).toThrow();
    expect(()=>cloudMigrationCommand({...config,projectRef:'prod-ref'},environment)).toThrow();
  });
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
