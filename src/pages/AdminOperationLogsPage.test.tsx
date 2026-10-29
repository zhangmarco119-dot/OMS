import { render, screen, waitFor } from '@testing-library/react';
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

it('includes salary and attendance views by default even with the old hidden-view setting', async () => {
  sessionStorage.setItem('storehub:page-state:/app/admin/operation-logs:operation-log-key-only', 'true');
  render(<MemoryRouter initialEntries={['/app/admin/operation-logs']}><AdminOperationLogsPage /></MemoryRouter>);
  expect(screen.getByRole('checkbox', { name: '只看关键操作' })).not.toBeChecked();
  await waitFor(() => expect(loadOperationLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyOnly: false, excludeActorId: '' })));
});

it('distinguishes sending a payslip from editing an already issued payslip', async () => {
  vi.mocked(loadOperationLogs).mockResolvedValueOnce({ items: [
    { id: 'sent', actor_id: 'admin', actor_name_snapshot: '管理员', actor_role_snapshot: 'admin', actor_employment_type_snapshot: 'full_time', actor_username_snapshot: 'admin', store_id: null, module: 'payroll', operation: 'updated', entity_type: 'payroll_payslips', entity_id: 'slip', summary: '2026-10工资单', occurred_at: '2026-10-29T10:00:00Z', metadata: { beforeStatus: 'draft', afterStatus: 'issued' }, repeatCount: 1 },
    { id: 'edited', actor_id: 'admin', actor_name_snapshot: '管理员', actor_role_snapshot: 'admin', actor_employment_type_snapshot: 'full_time', actor_username_snapshot: 'admin', store_id: null, module: 'payroll', operation: 'updated', entity_type: 'payroll_payslips', entity_id: 'slip', summary: '2026-10工资单', occurred_at: '2026-10-29T11:00:00Z', metadata: { beforeStatus: 'issued', afterStatus: 'issued' }, repeatCount: 1 },
  ], rawCount: 2, total: 2 });
  render(<MemoryRouter><AdminOperationLogsPage /></MemoryRouter>);
  expect(await screen.findByText('发送工资单')).toBeVisible();
  expect(screen.getByText('修改')).toBeVisible();
});
