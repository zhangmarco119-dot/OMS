import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadOperationLogs } from '../services/operation-logs.service';
import { AdminOperationLogsPage } from './AdminOperationLogsPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'admin' }, availableStores: [] }) }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/operation-logs.service', async (original) => ({
  ...await original<typeof import('../services/operation-logs.service')>(),
  loadOperationLogActors: vi.fn().mockResolvedValue([]),
  loadOperationLogs: vi.fn().mockResolvedValue({ items: [], rawCount: 0, total: 0 }),
}));

beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });

it('shows repeated actions at different times separately across load-more results', async () => {
  const first = { id: 'view-1', actor_id: 'staff', actor_name_snapshot: '员工', actor_role_snapshot: 'staff' as const, actor_employment_type_snapshot: 'full_time' as const, actor_username_snapshot: 'staff', store_id: null, module: 'payroll', operation: 'viewed' as const, entity_type: 'payroll_estimate_detail', entity_id: 'staff', summary: '查看本人的预估薪资', occurred_at: '2026-10-29T10:00:00Z', metadata: {} };
  const second = { ...first, id: 'view-2', occurred_at: '2026-10-29T11:00:00Z' };
  vi.mocked(loadOperationLogs).mockResolvedValueOnce({ items: [first], rawCount: 1, total: 2 }).mockResolvedValueOnce({ items: [first, second], rawCount: 2, total: 2 });
  render(<MemoryRouter><AdminOperationLogsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
  await waitFor(() => expect(screen.getAllByText('薪资 · 查看本人的预估薪资')).toHaveLength(2));
  expect(screen.getByText(/18:00:00/)).toBeVisible();
  expect(screen.getByText(/19:00:00/)).toBeVisible();
  expect(screen.queryByText(/连续.*次/)).not.toBeInTheDocument();
});

it('includes salary and attendance views by default even with the old hidden-view setting', async () => {
  sessionStorage.setItem('storehub:page-state:/app/admin/operation-logs:operation-log-key-only', 'true');
  render(<MemoryRouter initialEntries={['/app/admin/operation-logs']}><AdminOperationLogsPage /></MemoryRouter>);
  expect(screen.getByRole('checkbox', { name: '只看关键操作' })).not.toBeChecked();
  await waitFor(() => expect(loadOperationLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyOnly: false, excludeActorId: '' })));
});

it('distinguishes sending a payslip from editing an already issued payslip', async () => {
  vi.mocked(loadOperationLogs).mockResolvedValueOnce({ items: [
    { id: 'sent', actor_id: 'admin', actor_name_snapshot: '管理员', actor_role_snapshot: 'admin', actor_employment_type_snapshot: 'full_time', actor_username_snapshot: 'admin', store_id: null, module: 'payroll', operation: 'updated', entity_type: 'payroll_payslips', entity_id: 'slip', summary: '2026-10工资单', occurred_at: '2026-10-29T10:00:00Z', metadata: { beforeStatus: 'draft', afterStatus: 'issued' } },
    { id: 'edited', actor_id: 'admin', actor_name_snapshot: '管理员', actor_role_snapshot: 'admin', actor_employment_type_snapshot: 'full_time', actor_username_snapshot: 'admin', store_id: null, module: 'payroll', operation: 'updated', entity_type: 'payroll_payslips', entity_id: 'slip', summary: '2026-10工资单', occurred_at: '2026-10-29T11:00:00Z', metadata: { beforeStatus: 'issued', afterStatus: 'issued' } },
  ], rawCount: 2, total: 2 });
  render(<MemoryRouter><AdminOperationLogsPage /></MemoryRouter>);
  expect(await screen.findByText('发送工资单')).toBeVisible();
  expect(screen.getByText('修改')).toBeVisible();
});
