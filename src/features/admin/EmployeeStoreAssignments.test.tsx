import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployeeStoreAssignments } from './EmployeeStoreAssignments';

const db = vi.hoisted(() => ({ rpc: vi.fn(), order: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: db.rpc, from: () => ({ select: () => ({ eq: () => ({ order: db.order }) }) }) } }));
const stores = [{ id: 'west', name: '西直门店', is_active: true }, { id: 'five', name: '五道口店', is_active: true }];
const period = (store: string) => ({ id: store, store_id: store, profile_id: 'employee', effective_from: '1900-01-01', effective_to: null });

describe('dated employee store assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-10-26T08:00:00Z'));
    db.order.mockResolvedValue({ data: [period('west'), period('five')], error: null });
    db.rpc.mockResolvedValue({ error: null });
  });

  it('saves the selected cancellation date without deleting historical data', async () => {
    const changed = vi.fn();
    render(<EmployeeStoreAssignments onChanged={changed} profileId="employee" stores={stores} />);
    const buttons = await screen.findAllByRole('button', { name: '按日期取消关联' });
    fireEvent.click(buttons[0]);
    fireEvent.change(screen.getByLabelText('取消关联生效日期'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: '保存取消日期' }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('admin_end_profile_store', { p_profile_id: 'employee', p_store_id: 'west', p_effective_date: '2026-10-01' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it('keeps the remaining store and offers readdition after cancellation', async () => {
    db.order.mockResolvedValue({ data: [{ ...period('west'), effective_to: '2026-10-01' }, period('five')], error: null });
    render(<EmployeeStoreAssignments profileId="employee" stores={stores} />);
    expect(await screen.findByRole('button', { name: '按日期取消关联' })).toBeDisabled();
    expect(screen.getByText(/仅关联一个门店，跨店工时、薪资分配已停用/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('增加关联门店'), { target: { value: 'west' } });
    fireEvent.click(screen.getByRole('button', { name: '增加门店关联' }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('admin_set_profile_stores', { p_profile_id: 'employee', p_store_ids: ['five', 'west'] }));
  });

  it('shows a read failure and never treats it as an empty membership list', async () => {
    db.order.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    render(<EmployeeStoreAssignments profileId="employee" stores={stores} />);
    expect(await screen.findByRole('button', { name: '关联加载失败，点击重试' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '增加门店关联' })).not.toBeInTheDocument();
  });
});
