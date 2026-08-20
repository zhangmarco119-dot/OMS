import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PayrollEstimate } from './model';
import { PayrollDeductionRow } from './PayrollDeductionDetails';

const mocks = vi.hoisted(() => ({
  loadItems: vi.fn(),
  loadAssets: vi.fn(),
  loadAssetUrl: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../services/payroll.service', () => ({
  loadPayrollDeductionItems: mocks.loadItems,
  loadPayrollPenaltyAssets: mocks.loadAssets,
  loadPayrollPenaltyAssetUrl: mocks.loadAssetUrl,
}));

const estimate = {
  asOf: '2026-08-20',
  deductionItems: [{
    amount: 50,
    createdAt: '2026-08-20T01:00:00Z',
    date: '2026-08-20',
    id: 'penalty:penalty-1',
    performanceDeduction: 3,
    reason: '盘点差异处罚',
    title: '其他罚款',
    type: 'penalty',
  }],
  displayName: '员工甲',
  fineTotal: 50,
  monthEnd: '2026-08-31',
  monthStart: '2026-08-01',
  profileId: 'staff-1',
} as PayrollEstimate;

const asset = {
  bucket: 'payroll-evidence',
  created_at: '2026-08-20T01:00:01Z',
  file_name: '罚单现场.png',
  id: 'asset-1',
  mime_type: 'image/png',
  object_path: 'manager-1/penalty/penalty-1/image.png',
  penalty_id: 'penalty-1',
  size_bytes: 1024,
  uploaded_by: 'manager-1',
} as const;

describe('PayrollDeductionRow penalty evidence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders deduction metadata first, then resolves and previews its images locally', async () => {
    let resolveAssets: (value: [typeof asset]) => void = () => undefined;
    let resolveUrl: (value: string) => void = () => undefined;
    mocks.loadAssets.mockReturnValue(new Promise((resolve) => { resolveAssets = resolve; }));
    mocks.loadAssetUrl.mockReturnValue(new Promise((resolve) => { resolveUrl = resolve; }));

    render(<PayrollDeductionRow estimate={estimate} label="罚款合计" total={50} />);
    fireEvent.click(screen.getByRole('button', { name: /罚款合计/ }));
    expect(screen.getByText('盘点差异处罚')).toBeInTheDocument();
    expect(screen.getByText('正在加载图片')).toBeInTheDocument();

    await act(async () => resolveAssets([asset]));
    expect(screen.getByText('盘点差异处罚')).toBeInTheDocument();
    expect(screen.getByText('正在加载图片')).toBeInTheDocument();
    await act(async () => resolveUrl('blob:employee-penalty-evidence'));

    const image = await screen.findByRole('img', { name: '罚单现场.png' });
    fireEvent.load(image);
    await waitFor(() => expect(screen.queryByText('正在加载图片')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '查看罚单图片 罚单现场.png' }));
    expect(screen.getByRole('dialog', { name: '罚单图片预览' })).toBeInTheDocument();
  });

  it('keeps the deduction visible and shows an image-local failure after metadata loading fails', async () => {
    mocks.loadAssets.mockRejectedValue(new Error('storage unavailable'));
    render(<PayrollDeductionRow estimate={estimate} label="罚款合计" total={50} />);
    fireEvent.click(screen.getByRole('button', { name: /罚款合计/ }));

    expect(screen.getByText('盘点差异处罚')).toBeInTheDocument();
    expect(await screen.findByText('图片预览加载失败')).toBeInTheDocument();
    expect(screen.getByText('盘点差异处罚')).toBeInTheDocument();
  });

  it('loads and displays a valid penalty record when its monetary amount is zero', async () => {
    mocks.loadItems.mockResolvedValue([{ ...estimate.deductionItems[0], amount: 0, reason: '仅扣绩效分，不罚款' }]);
    mocks.loadAssets.mockResolvedValue([]);
    render(<PayrollDeductionRow estimate={{ ...estimate, deductionItems: [], fineTotal: 0 }} label="罚款合计" total={0} />);

    fireEvent.click(screen.getByRole('button', { name: /罚款合计/ }));

    expect(await screen.findByText('仅扣绩效分，不罚款')).toBeInTheDocument();
    expect(mocks.loadItems).toHaveBeenCalledWith(expect.anything(), 'staff-1', '2026-08-01', '2026-08-20');
    expect(screen.queryByText('本期没有扣款记录。')).not.toBeInTheDocument();
  });
});
