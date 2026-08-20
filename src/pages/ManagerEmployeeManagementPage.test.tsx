import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagerEmployeeManagementPage } from './ManagerEmployeeManagementPage';

const mocks = vi.hoisted(() => ({
  auth: {
    availableStores: [{ id: 'store-1', name: '测试门店' }],
    profile: { id: 'manager-1', role: 'manager' },
  },
  loadManagerStoreStaff: vi.fn(),
}));

const emptyQuery = () => {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'limit', 'order', 'select']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
};

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => emptyQuery()) } }));
vi.mock('../services/payroll.service', () => ({
  loadManagerStoreStaff: mocks.loadManagerStoreStaff,
  managerCreatePayrollPenalty: vi.fn(),
  uploadPayrollEvidence: vi.fn(),
}));

describe('ManagerEmployeeManagementPage penalty images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadManagerStoreStaff.mockResolvedValue([{ display_name: '员工甲', id: 'staff-1', is_active: true, store_id: 'store-1' }]);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:manager-penalty-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('shows removable thumbnails and full-screen preview before publishing', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ManagerEmployeeManagementPage /></MemoryRouter>);
    await screen.findByRole('option', { name: '员工甲' });
    const input = screen.getByText('点击上传说明图片').closest('label')?.querySelector('input[type="file"]');
    const file = new File(['image'], '现场照片.png', { type: 'image/png' });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    expect(screen.getByRole('img', { name: '现场照片.png' })).toHaveAttribute('src', 'blob:manager-penalty-preview');
    fireEvent.click(screen.getByRole('button', { name: '预览 现场照片.png' }));
    expect(screen.getByRole('dialog', { name: '罚单图片预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    fireEvent.click(screen.getByRole('button', { name: '删除 现场照片.png' }));
    expect(screen.queryByRole('img', { name: '现场照片.png' })).not.toBeInTheDocument();
  });
});
