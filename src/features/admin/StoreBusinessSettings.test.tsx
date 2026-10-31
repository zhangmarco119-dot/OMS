import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StoreBusinessSettings } from './StoreBusinessSettings';
import { loadStoreClosures, setStoreOperating } from '../../services/store-business.service';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ availableStores: [{ id: 'west', name: '西直门店' }] }) }));
vi.mock('../../services/store-business.service', async (original) => ({
  ...await original<typeof import('../../services/store-business.service')>(),
  loadStoreClosures: vi.fn().mockResolvedValue([]), setStoreOperating: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadStoreClosures).mockResolvedValue([]); });

it('requires confirmation and saves the selected closure date instead of deactivating account access', async () => {
  const changed = vi.fn();
  render(<StoreBusinessSettings onChanged={changed} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '设置为关店' })).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('西直门店关店日期'), { target: { value: '2026-10-15' } });
  fireEvent.click(screen.getByRole('button', { name: '设置为关店' }));
  expect(setStoreOperating).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认设置' }));
  await waitFor(() => expect(setStoreOperating).toHaveBeenCalledWith(expect.anything(), 'west', false, '2026-10-15'));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it('shows the closed date and offers restoring business while keeping store access visible', async () => {
  vi.mocked(loadStoreClosures).mockResolvedValue([{ id: 'closed', store_id: 'west', closed_from: '2026-10-15', reopened_from: null, resume_sales_sync: true, updated_by: 'admin', updated_at: '' }]);
  render(<StoreBusinessSettings onChanged={vi.fn()} />);
  expect(await screen.findByText('已关店')).toBeVisible();
  expect(screen.getByText('关店生效日：2026-10-15')).toBeVisible();
  expect(screen.getByRole('button', { name: '恢复营业' })).toBeVisible();
});
