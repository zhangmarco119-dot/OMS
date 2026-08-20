import { describe, expect, it, vi } from 'vitest';

import { completeAdminManagerPenaltyTodo, completeAdminPayrollConfirmationTodo, loadAdminManagerPenaltyTodos, loadAdminPayrollConfirmationTodos, loadTodoSummary } from './todo.service';

function query(result: { count?: number; data?: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'is', 'or', 'order', 'select', 'update']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain as never;
}

describe('administrator payroll confirmation todos', () => {
  it('counts unread employee confirmations in the administrator todo badge', async () => {
    let notificationQuery = 0;
    const from = vi.fn((table: string) => query({ count: table === 'notifications' && notificationQuery++ === 0 ? 2 : 0, data: [], error: null }));
    const rpc = vi.fn(async () => ({ data: 0, error: null }));

    const result = await loadTodoSummary({ from, rpc } as never, { isAdmin: true, profileId: 'admin-1' });

    expect(result).toMatchObject({ count: 2, payrollConfirmations: 2 });
  });

  it('counts unread manager-issued penalties in the administrator todo badge', async () => {
    let notificationQuery = 0;
    const from = vi.fn((table: string) => query({ count: table === 'notifications' && notificationQuery++ === 1 ? 3 : 0, data: [], error: null }));
    const result = await loadTodoSummary({ from, rpc: vi.fn(async () => ({ data: 0, error: null })) } as never, { isAdmin: true, profileId: 'admin-1' });
    expect(result).toMatchObject({ count: 3, managerPenalties: 3 });
  });

  it('loads only unread confirmation notifications assigned to the current administrator', async () => {
    const rows = [{ id: 'notification-1', title: '员工甲已确认工资单' }];
    const notifications = query({ data: rows, error: null });

    await expect(loadAdminPayrollConfirmationTodos({ from: vi.fn(() => notifications) } as never, 'admin-1')).resolves.toEqual(rows);
    expect((notifications as unknown as { eq: ReturnType<typeof vi.fn> }).eq).toHaveBeenCalledWith('recipient_user_id', 'admin-1');
    expect((notifications as unknown as { eq: ReturnType<typeof vi.fn> }).eq).toHaveBeenCalledWith('type', 'payroll_payslip_confirmed');
    expect((notifications as unknown as { eq: ReturnType<typeof vi.fn> }).eq).toHaveBeenCalledWith('is_read', false);
  });

  it('marks a confirmation todo read after the administrator acknowledges it', async () => {
    const notifications = query({ data: null, error: null });
    await completeAdminPayrollConfirmationTodo({ from: vi.fn(() => notifications) } as never, 'notification-1');

    expect((notifications as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(expect.objectContaining({ is_read: true }));
    expect((notifications as unknown as { eq: ReturnType<typeof vi.fn> }).eq).toHaveBeenCalledWith('id', 'notification-1');
  });

  it('loads and acknowledges unread manager penalty notifications', async () => {
    const rows = [{ id: 'manager-penalty-1', title: '店长已给员工开罚单' }];
    const loadQuery = query({ data: rows, error: null });
    await expect(loadAdminManagerPenaltyTodos({ from: vi.fn(() => loadQuery) } as never)).resolves.toEqual(rows);
    expect((loadQuery as unknown as { eq: ReturnType<typeof vi.fn> }).eq).toHaveBeenCalledWith('recipient_role', 'admin');
    expect((loadQuery as unknown as { eq: ReturnType<typeof vi.fn> }).eq).toHaveBeenCalledWith('type', 'manager_penalty_created');

    const updateQuery = query({ data: null, error: null });
    await completeAdminManagerPenaltyTodo({ from: vi.fn(() => updateQuery) } as never, 'manager-penalty-1');
    expect((updateQuery as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(expect.objectContaining({ is_read: true }));
  });
});
