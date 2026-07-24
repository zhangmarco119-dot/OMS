import { describe, expect, it } from 'vitest';

import { createTaxReports } from './tax-accounting.service';

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
});
