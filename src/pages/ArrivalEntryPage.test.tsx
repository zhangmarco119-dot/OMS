import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    resetDraft: vi.fn(),
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

  it('confirms before clearing and refreshing the current draft', async () => {
    setRole('staff');
    const resetDraft = vi.fn().mockResolvedValue(undefined);
    setReadyDraft({ resetDraft });
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ArrivalEntryPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '更新草稿' }));
    expect(screen.getByRole('dialog', { name: '确认更新当前草稿？' })).toHaveTextContent('产品明细和全部图片');
    fireEvent.click(screen.getByRole('button', { name: '清空并更新草稿' }));

    await waitFor(() => expect(resetDraft).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/草稿已更新为当前时间/)).toBeInTheDocument();
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

  it('shows missing request fields inside the dialog and submits once after completion', async () => {
    setRole('staff');
    const submit = vi.fn().mockResolvedValue('00000000-0000-4000-8000-000000000301');
    setReadyDraft({
      form: {
        arrivalDate: '2026-08-02',
        arrivalTime: '12:42',
        carrierName: '',
        items: [{ id: '00000000-0000-4000-8000-000000000201', isUnmatchedProduct: true, note: '', productId: null, productName: '测试1', quantity: '1', sortOrder: 0, spec: '', unit: '个' }],
        note: '',
        trackingNo: '',
      },
      images: [
        { arrival_item_id: null, bucket: 'arrival-report-images', created_at: '2026-08-02T04:42:00Z', file_name: 'waybill.jpg', height: 100, id: '00000000-0000-4000-8000-000000000401', image_type: 'waybill', mime_type: 'image/jpeg', object_path: 'waybill.jpg', report_id: '00000000-0000-4000-8000-000000000301', signedUrl: 'https://example.com/waybill.jpg', size_bytes: 100, store_id: '00000000-0000-4000-8000-000000000101', uploaded_by: '00000000-0000-4000-8000-000000000001', width: 100 },
        { arrival_item_id: '00000000-0000-4000-8000-000000000201', bucket: 'arrival-report-images', created_at: '2026-08-02T04:42:00Z', file_name: 'goods.jpg', height: 100, id: '00000000-0000-4000-8000-000000000402', image_type: 'goods', mime_type: 'image/jpeg', object_path: 'goods.jpg', report_id: '00000000-0000-4000-8000-000000000301', signedUrl: 'https://example.com/goods.jpg', size_bytes: 100, store_id: '00000000-0000-4000-8000-000000000101', uploaded_by: '00000000-0000-4000-8000-000000000001', width: 100 },
      ],
      submit,
    });
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ArrivalEntryPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '提交上报' }));
    fireEvent.click(screen.getByRole('button', { name: '提交并申请新增' }));

    expect(screen.getByRole('alert')).toHaveTextContent('未匹配货品 1：请填写规格');
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(within(screen.getByRole('dialog', { name: '发现未匹配货品' })).getByLabelText('规格'), { target: { value: '1kg/袋' } });
    fireEvent.click(screen.getByRole('button', { name: '提交并申请新增' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith([expect.objectContaining({ specification: '1kg/袋' })]);
    expect(screen.queryByRole('dialog', { name: '确认提交到货上报' })).not.toBeInTheDocument();
  });

  it('blocks an unmatched add request when the same product name already exists', () => {
    setRole('staff');
    setReadyDraft({
      form: {
        arrivalDate: '2026-08-02', arrivalTime: '12:42', carrierName: '', note: '', trackingNo: '',
        items: [{ id: '00000000-0000-4000-8000-000000000201', isUnmatchedProduct: true, note: '', productId: null, productName: '  原味 酸奶 ', quantity: '1', sortOrder: 0, spec: '', unit: '杯' }],
      },
      images: [
        { arrival_item_id: null, bucket: 'arrival-report-images', created_at: '2026-08-02T04:42:00Z', file_name: 'waybill.jpg', height: 100, id: '00000000-0000-4000-8000-000000000401', image_type: 'waybill', mime_type: 'image/jpeg', object_path: 'waybill.jpg', report_id: '00000000-0000-4000-8000-000000000301', signedUrl: 'https://example.com/waybill.jpg', size_bytes: 100, store_id: '00000000-0000-4000-8000-000000000101', uploaded_by: '00000000-0000-4000-8000-000000000001', width: 100 },
        { arrival_item_id: '00000000-0000-4000-8000-000000000201', bucket: 'arrival-report-images', created_at: '2026-08-02T04:42:00Z', file_name: 'goods.jpg', height: 100, id: '00000000-0000-4000-8000-000000000402', image_type: 'goods', mime_type: 'image/jpeg', object_path: 'goods.jpg', report_id: '00000000-0000-4000-8000-000000000301', signedUrl: 'https://example.com/goods.jpg', size_bytes: 100, store_id: '00000000-0000-4000-8000-000000000101', uploaded_by: '00000000-0000-4000-8000-000000000001', width: 100 },
      ],
      products: [{ category_code: 'other_food', count_unit: '杯', created_at: '', id: 'product-1', is_active: true, name: '原味 酸奶', product_code: null, sort_order: 1, spec: '120g', store_id: '00000000-0000-4000-8000-000000000101', updated_at: '' }],
    });
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><ArrivalEntryPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '提交上报' }));

    expect(screen.queryByRole('dialog', { name: '发现未匹配货品' })).not.toBeInTheDocument();
    expect(screen.getByText(/货品列表中已有货品“原味 酸奶”/)).toBeInTheDocument();
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
