import { describe, expect, it, vi } from 'vitest';

import { createTaxReports, deleteTaxPerson, loadTaxAttendancePunches, saveTaxMonthlySalary } from './tax-accounting.service';

describe('createTaxReports', () => {
  it('uses the selected month real-time estimate for every linked account', () => {
    const reports = createTaxReports(
      [{ id: 'store-1', name: 'OMEGA酸奶（西直门店）' }] as never,
      [{
        full_name: '测试员工',
        id: 'person-1',
        id_number: '110101199001011234',
        is_active: true,
        phone: '13800138000',
        profile_id: 'profile-1',
        reporting_store_id: 'store-1',
      }] as never,
      [],
      [{
        estimatedPayable: 4321.5,
        knownEstimatedPayable: 4000,
        profileId: 'profile-1',
      }] as never,
      [{ company_name: '咖啡真好喝有限公司', store_id: 'store-1' }] as never,
    );

    expect(reports[0]).toMatchObject({
      companyName: '咖啡真好喝有限公司',
      rows: [{ amount: 4321.5, salarySource: 'system' }],
      total: 4321.5,
    });
  });

  it('deletes a tax reporting person and relies on the database cascade for monthly overrides', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: remove }));
    await deleteTaxPerson({ from } as never, 'person-1');
    expect(from).toHaveBeenCalledWith('tax_reporting_people');
    expect(remove).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('id', 'person-1');
  });
});

describe('historical tax attendance loading', () => {
  const ids = Array.from({ length: 120 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
  it('splits the September-sized UUID list into short queries without losing rows', async () => {
    const batches: string[][] = [];
    const client = { from: vi.fn(() => {
      let batch: string[] = [];
      const query = { select: vi.fn(() => query), in: vi.fn((_field, values: string[]) => { batch = values; batches.push(values); return query; }), order: vi.fn(() => query), range: vi.fn(async () => ({ data: batch.map((id) => ({ daily_record_id: id })), error: null })) };
      return query;
    }) };
    const result = await loadTaxAttendancePunches(client as never, [...ids, ids[0]]);
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(result.map((row) => row.daily_record_id)).toEqual(ids);
    expect(batches.every((batch) => new URLSearchParams({ daily_record_id: `in.(${batch.join(',')})` }).toString().length < 2200)).toBe(true);
  });
  it('does not request punches for an empty month', async () => {
    const from = vi.fn();
    expect(await loadTaxAttendancePunches({ from } as never, [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
  it('paginates a dense batch instead of truncating its punches', async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 500 }, () => ({ daily_record_id: ids[0] })), error: null }).mockResolvedValueOnce({ data: [{ daily_record_id: ids[0] }], error: null });
    const query = { select: () => query, in: () => query, order: () => query, range };
    expect(await loadTaxAttendancePunches({ from: () => query } as never, [ids[0]])).toHaveLength(501);
    expect(range.mock.calls).toEqual([[0, 499], [500, 999]]);
  });
  it('fails on a rejected batch rather than returning partial accounting data', async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: [{ daily_record_id: ids[0] }], error: null }).mockResolvedValueOnce({ data: null, error: { message: '读取失败' } });
    const query = { select: () => query, in: () => query, order: () => query, range };
    await expect(loadTaxAttendancePunches({ from: () => query } as never, ids)).rejects.toThrow('读取失败');
  });
  it('writes a manual salary to the selected historical month, including zero', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    await saveTaxMonthlySalary({ from: () => ({ upsert }) } as never, 'admin', 'person', '2026-09', 0);
    expect(upsert).toHaveBeenCalledWith({ manual_amount: 0, payroll_month: '2026-09-01', person_id: 'person', updated_by: 'admin' }, { onConflict: 'person_id,payroll_month' });
  });
});
