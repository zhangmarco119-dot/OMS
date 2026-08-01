import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useArrivalDraft } from '../features/arrivals/useArrivalDraft';
import { useAuth } from '../features/auth/AuthContext';
import type { UserRole } from '../types/domain';
import { ArrivalEntryPage } from './ArrivalEntryPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/arrivals/useArrivalDraft', () => ({ useArrivalDraft: vi.fn() }));

const setRole = (role: UserRole) => {
  vi.mocked(useAuth).mockReturnValue({
    profile: { id: '00000000-0000-4000-8000-000000000001', role },
    store: { id: '00000000-0000-4000-8000-000000000101', name: '测试门店' },
  } as unknown as ReturnType<typeof useAuth>);
};

const setReadyDraft = (overrides: Partial<ReturnType<typeof useArrivalDraft>> = {}) => {
  vi.mocked(useArrivalDraft).mockReturnValue({
    addImage: vi.fn(),
    addItem: vi.fn(),
    deleteImage: vi.fn(),
    form: {
      arrivalDate: '2026-07-12',
      arrivalTime: '12:00',
      carrierName: '',
      items: [{
        id: '00000000-0000-4000-8000-000000000201',
        isUnmatchedProduct: true,
        note: '',
        productId: null,
        productName: '',
        quantity: '',
        sortOrder: 0,
        spec: '',
        unit: '',
      }],
      note: '',
      trackingNo: '',
    },
    images: [],
    loadStatus: 'ready',
    message: null,
    products: [],
    reload: vi.fn(),
    removeItem: vi.fn(),
    report: {
      id: '00000000-0000-4000-8000-000000000301',
      report_no: 'ARR-20260712-00000001',
    },
    saveNow: vi.fn(),
    saveStatus: 'idle',
    submit: vi.fn(),
    updateField: vi.fn(),
    updateItem: vi.fn(),
    uploadCount: 0,
    ...overrides,
  } as unknown as ReturnType<typeof useArrivalDraft>);
};

describe('ArrivalEntryPage role boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setReadyDraft();
  });

  it.each(['staff', 'manager'] as const)('uses the same complete V2 form for %s', (role) => {
    setRole(role);
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <ArrivalEntryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '到货上报' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    const submitButton = screen.getByRole('button', { name: '提交上报' });
    expect(submitButton).toBeEnabled();
    expect(screen.queryByText(/提交前还需完成/)).not.toBeInTheDocument();

    fireEvent.click(submitButton);

    expect(screen.getByRole('dialog', { name: '请先完善到货信息' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '请先完善到货信息' })).toHaveClass('ui-dialog-overlay');
    expect(screen.getByText(/至少上传一张面单照片/)).toBeInTheDocument();
  });

  it('keeps the submission confirmation above the bottom navigation', () => {
    setRole('staff');
    setReadyDraft({
      form: {
        arrivalDate: '2026-07-13',
        arrivalTime: '23:59',
        carrierName: '',
        items: [{ id: '00000000-0000-4000-8000-000000000201', isUnmatchedProduct: true, note: '', productId: null, productName: '测试商品', quantity: '2', sortOrder: 0, spec: '', unit: '个' }],
        note: '',
        trackingNo: '',
      },
      images: [
        { arrival_item_id: null, bucket: 'arrival-report-images', created_at: '2026-07-13T15:59:00Z', file_name: 'waybill.jpg', height: 100, id: '00000000-0000-4000-8000-000000000401', image_type: 'waybill', mime_type: 'image/jpeg', object_path: 'waybill.jpg', report_id: '00000000-0000-4000-8000-000000000301', signedUrl: 'https://example.com/waybill.jpg', size_bytes: 100, store_id: '00000000-0000-4000-8000-000000000101', uploaded_by: '00000000-0000-4000-8000-000000000001', width: 100 },
        { arrival_item_id: '00000000-0000-4000-8000-000000000201', bucket: 'arrival-report-images', created_at: '2026-07-13T15:59:00Z', file_name: 'goods.jpg', height: 100, id: '00000000-0000-4000-8000-000000000402', image_type: 'goods', mime_type: 'image/jpeg', object_path: 'goods.jpg', report_id: '00000000-0000-4000-8000-000000000301', signedUrl: 'https://example.com/goods.jpg', size_bytes: 100, store_id: '00000000-0000-4000-8000-000000000101', uploaded_by: '00000000-0000-4000-8000-000000000001', width: 100 },
      ],
    });
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ArrivalEntryPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '提交上报' }));

    expect(screen.getByRole('dialog', { name: '发现未匹配货品' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '仅提交上报' }));

    const dialog = screen.getByRole('dialog', { name: '确认提交到货上报' });
    expect(dialog).toHaveClass('ui-dialog-overlay');
    expect(dialog.firstElementChild).toHaveClass('ui-dialog-panel');
    expect(screen.getByRole('button', { name: '确认提交' })).toBeVisible();
  });

  it('keeps the administrator outside the store execution page', () => {
    setRole('admin');
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <ArrivalEntryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '当前账号不能执行到货上报' })).toBeInTheDocument();
  });
});
