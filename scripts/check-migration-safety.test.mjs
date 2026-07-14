import { describe, expect, it } from 'vitest';

import { inspectMigrationSql, validateMigrationChanges } from './check-migration-safety.mjs';

describe('Migration safety guard', () => {
  it('accepts a new forward-only migration', () => {
    const result = validateMigrationChanges({
      changes: [{ status: 'A', file: 'supabase/migrations/0038_add_example.sql' }],
      readSql: () => 'alter table public.products add column if not exists example text;',
      baseMigrationNames: ['0037_previous.sql'],
    });
    expect(result.errors).toEqual([]);
    expect(result.newMigrations).toEqual(['supabase/migrations/0038_add_example.sql']);
  });

  it('rejects changed history and destructive test cleanup', () => {
    const result = validateMigrationChanges({
      changes: [
        { status: 'M', file: 'supabase/migrations/0037_previous.sql' },
        { status: 'A', file: 'supabase/migrations/0038_clear_test_data.sql' },
      ],
      readSql: () => 'truncate table public.v2_tasks;',
      baseMigrationNames: ['0037_previous.sql'],
    });
    expect(result.errors.some((error) => error.includes('不得修改'))).toBe(true);
    expect(result.errors.some((error) => error.includes('测试数据清理'))).toBe(true);
    expect(result.errors.some((error) => error.includes('TRUNCATE'))).toBe(true);
  });

  it('rejects data deletion and table drops', () => {
    expect(inspectMigrationSql('0038_bad.sql', 'delete from public.tasks; drop table public.tasks;')).toEqual([
      '禁止在发布 Migration 中删除表、Schema 或数据库',
      '禁止在发布 Migration 中直接清理业务数据',
    ]);
  });

  it('allows reviewed business deletion logic inside a stored function body', () => {
    const sql = 'create function public.remove_example() returns void language plpgsql as $$ begin delete from public.examples; end; $$;';
    expect(inspectMigrationSql('0038_add_remove_example_rpc.sql', sql)).toEqual([]);
  });
});
