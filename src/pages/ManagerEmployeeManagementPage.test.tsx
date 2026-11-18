import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagerEmployeeManagementPage } from './ManagerEmployeeManagementPage';

const mocks = vi.hoisted(() => ({
  auth: {
    availableStores: [{ id: 'store-1', name: '测试门店' }],
    profile: { id: 'manager-1', role: 'manager' },
  },
  loadManagerStoreStaff: vi.fn(),
  createPenalty: vi.fn(),
  uploadEvidence: vi.fn(),
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
  managerCreatePayrollPenalty: mocks.createPenalty,
  uploadPayrollEvidence: mocks.uploadEvidence,
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

  it('keeps selected photos when the picker is cancelled and retries failed uploads without creating another penalty', async () => {
    mocks.createPenalty.mockResolvedValue({ id: 'penalty-1' });
    mocks.uploadEvidence.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(undefined);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ManagerEmployeeManagementPage /></MemoryRouter>);
    await screen.findByRole('option', { name: '员工甲' });
    fireEvent.change(screen.getByLabelText('员工'), { target: { value: 'staff-1' } });
    fireEvent.change(screen.getByPlaceholderText('请填写具体原因'), { target: { value: '测试原因' } });
    const input = screen.getByText('点击上传说明图片').closest('label')!.querySelector('input[type="file"]')!;
    const file = new File(['image'], '照片.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.getByRole('img', { name: '照片.jpg' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发布罚单' }));
    expect(await screen.findByText(/图片上传失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试上传图片' }));
    await waitFor(() => expect(mocks.uploadEvidence).toHaveBeenCalledTimes(2));
    expect(mocks.createPenalty).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('罚单已发布，已通知员工和管理员。')).toBeInTheDocument();
  });

  it('reports an unsupported image before allowing the penalty to be issued', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ManagerEmployeeManagementPage /></MemoryRouter>);
    await screen.findByRole('option', { name: '员工甲' });
    const input = screen.getByText('点击上传说明图片').closest('label')!.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['image'], '图片.heic', { type: 'image/heic' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('只支持 JPG、PNG 或 WEBP');
    fireEvent.click(screen.getByRole('button', { name: '发布罚单' }));
    expect(mocks.createPenalty).not.toHaveBeenCalled();
  });

  it('accepts a JPEG from a picker that omits its MIME type', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ManagerEmployeeManagementPage /></MemoryRouter>);
    await screen.findByRole('option', { name: '员工甲' });
    const input = screen.getByText('点击上传说明图片').closest('label')!.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['image'], '相册照片.jpg')] } });
    expect(screen.getByRole('img', { name: '相册照片.jpg' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('selects Android photos one at a time and appends each photo', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 16; wv)');
    try {
      render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ManagerEmployeeManagementPage /></MemoryRouter>);
      await screen.findByRole('option', { name: '员工甲' });
      const input = screen.getByText('点击上传说明图片').closest('label')!.querySelector('input[type="file"]')!;
      expect(input).not.toHaveAttribute('multiple');
      fireEvent.change(input, { target: { files: [new File(['a'], '第一张.jpg', { type: 'image/jpeg' })] } });
      fireEvent.change(input, { target: { files: [new File(['b'], '第二张.jpg', { type: 'image/jpeg' })] } });
      expect(screen.getByRole('img', { name: '第一张.jpg' })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: '第二张.jpg' })).toBeInTheDocument();
    } finally { ua.mockRestore(); }
  });
});
