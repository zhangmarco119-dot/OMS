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
