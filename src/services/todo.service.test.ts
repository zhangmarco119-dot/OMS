import { describe, expect, it, vi } from 'vitest';

import { completeAdminPayrollConfirmationTodo, loadAdminPayrollConfirmationTodos, loadTodoSummary } from './todo.service';

function query(result: { count?: number; data?: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'is', 'or', 'order', 'select', 'update']) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain as never;
}

describe('administrator payroll confirmation todos', () => {
  it('counts unread employee confirmations in the administrator todo badge', async () => {
    const from = vi.fn((table: string) => query({ count: table === 'notifications' ? 2 : 0, data: [], error: null }));
    const rpc = vi.fn(async () => ({ data: 0, error: null }));

    const result = await loadTodoSummary({ from, rpc } as never, { isAdmin: true, profileId: 'admin-1' });

    expect(result).toMatchObject({ count: 2, payrollConfirmations: 2 });
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
});
