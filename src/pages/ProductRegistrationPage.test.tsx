import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import {
  createProductRegistrationEntry,
  loadProductRegistrationEntries,
  loadProductRegistrationImageUrls,
  loadRegistrationProducts,
  type ProductRegistrationEntry,
  updateProductRegistrationEntry,
} from '../services/product-registration.service';
import { ProductRegistrationPage } from './ProductRegistrationPage';

const channel = { on: vi.fn(), subscribe: vi.fn() };
channel.on.mockReturnValue(channel);
vi.mock('../lib/supabase', () => ({ supabase: { channel: vi.fn(() => channel), removeChannel: vi.fn() } }));
vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/product-registration.service', () => ({
  PRODUCT_REGISTRATION_TYPES: [
    { key: 'packaging', label: '打包货品' }, { key: 'abandoned', label: '遗弃货品' }, { key: 'loaned_to_wudaokou', label: '借用到五道口的货品' }, { key: 'equipment', label: '设备' }, { key: 'other', label: '其他' },
  ],
  createProductRegistrationEntry: vi.fn(),
  deleteProductRegistrationEntry: vi.fn(),
  deleteProductRegistrationImage: vi.fn(),
  isProductRegistrationType: (value: string | null) => ['packaging', 'abandoned', 'loaned_to_wudaokou', 'equipment', 'other'].includes(value ?? ''),
  loadProductRegistrationEntries: vi.fn(),
  loadProductRegistrationImageUrls: vi.fn(),
  loadRegistrationProducts: vi.fn(),
  updateProductRegistrationEntry: vi.fn(),
  uploadProductRegistrationImage: vi.fn(),
}));

const entry: ProductRegistrationEntry = {
  created_at: '2026-09-30T08:00:00Z', created_by: 'staff-1', creatorName: '员工甲', id: 'entry-1', images: [], note: '', product_id: null, product_name: '', registration_type: 'packaging', status: 'draft', store_id: 'store-x', unit: '', updated_at: '2026-09-30T08:00:00Z',
};

describe('ProductRegistrationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel);
    vi.mocked(useAuth).mockReturnValue({ availableStores: [{ id: 'store-x', name: 'OMEGA酸奶（西直门店）' }], profile: { display_name: '员工甲', id: 'staff-1', role: 'staff' }, store: { id: 'store-x', name: 'OMEGA酸奶（西直门店）' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadProductRegistrationEntries).mockResolvedValue([entry]);
    vi.mocked(loadRegistrationProducts).mockResolvedValue([{ count_unit: '箱', id: 'product-1', name: '打包袋', spec: '大号' }]);
    vi.mocked(loadProductRegistrationImageUrls).mockResolvedValue({});
    vi.mocked(updateProductRegistrationEntry).mockResolvedValue(undefined);
  });

  it('provides five category menus and fills the unit from the Xizhimen catalog', async () => {
    render(<MemoryRouter><ProductRegistrationPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: '打包货品' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '遗弃货品' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '借用到五道口的货品' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设备' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '其他' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('货品名称'), { target: { value: '打包' } });
    fireEvent.click(screen.getByRole('button', { name: /打包袋/ }));
    expect(screen.getByLabelText('单位')).toHaveValue('箱');
    await waitFor(() => expect(updateProductRegistrationEntry).toHaveBeenCalledWith(expect.anything(), 'entry-1', expect.objectContaining({ product_id: 'product-1', unit: '箱' })));
  });

  it('keeps administrator view read-only while showing the registrant', async () => {
    vi.mocked(useAuth).mockReturnValue({ availableStores: [{ id: 'store-x', name: 'OMEGA酸奶（西直门店）' }], profile: { id: 'admin-1', role: 'admin' }, store: { id: 'store-x', name: 'OMEGA酸奶（西直门店）' } } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadProductRegistrationEntries).mockResolvedValue([{ ...entry, product_name: '打包袋', unit: '箱' }]);
    render(<MemoryRouter><ProductRegistrationPage adminView /></MemoryRouter>);
    expect(await screen.findByText(/登记人：员工甲/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '增加货品登记条目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除此登记条目' })).not.toBeInTheDocument();
  });

  it('creates a persistent draft entry in the current category', async () => {
    vi.mocked(createProductRegistrationEntry).mockResolvedValue({ ...entry, id: 'entry-2', creatorName: '' });
    render(<MemoryRouter><ProductRegistrationPage /></MemoryRouter>);
    await screen.findByText('待填写货品名称');
    fireEvent.click(screen.getByRole('button', { name: '增加货品登记条目' }));
    await waitFor(() => expect(createProductRegistrationEntry).toHaveBeenCalledWith(expect.anything(), { creatorId: 'staff-1', storeId: 'store-x', type: 'packaging' }));
  });
});
