import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminOperationOverview } from '../services/admin-operation-overview.service';
import { loadNotifications, markNotificationRead, type UserNotification } from '../services/notifications.service';
import { loadAdminPayrollEstimates } from '../services/payroll.service';
import { loadTodoSummary } from '../services/todo.service';
import { loadNotices } from '../services/v2-content.service';
import { loadV2Tasks } from '../services/v2-tasks.service';
import { DashboardPage } from './DashboardPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/notifications.service', () => ({
  loadNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));
vi.mock('../services/admin-operation-overview.service', () => ({ loadAdminOperationOverview: vi.fn() }));
vi.mock('../services/payroll.service', () => ({ loadAdminPayrollEstimates: vi.fn() }));
vi.mock('../services/todo.service', () => ({ loadTodoSummary: vi.fn() }));
vi.mock('../services/v2-content.service', () => ({ loadNotices: vi.fn() }));
vi.mock('../services/v2-tasks.service', () => ({ loadV2Tasks: vi.fn() }));

const notification = (id: string, title: string, isRead = false): UserNotification => ({
  body: `${title}内容`,
  created_at: '2026-07-14T10:00:00Z',
  dedupe_key: null,
  entity_id: `task-${id}`,
  entity_type: 'v2_task',
  id,
  is_read: isRead,
  read_at: isRead ? '2026-07-14T11:00:00Z' : null,
  recipient_role: null,
  recipient_user_id: 'profile-1',
  store_id: 'store-1',
  title,
  type: 'task_assigned',
});

describe('DashboardPage administrator payroll cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店' }],
      profile: { display_name: '管理员', id: 'admin-1', role: 'admin' },
      signOut: vi.fn(),
      store: { id: 'store-1', name: '测试门店' },
      user: { email: 'admin@example.com' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminOperationOverview).mockResolvedValue({ arrival_pending: 1, arrival_today: 2, inventory_completed_today: 3, inventory_pending: 0, v2_task_active: 4, v2_task_completed: 5 });
    vi.mocked(loadTodoSummary).mockResolvedValue({ count: 0, managerPenalties: 0, payrollConfirmations: 0, noticeAcknowledgements: 0, productCreationRequests: 0, productFeedback: 0, tasks: 0, overtime: 0, attendanceCorrections: 0, arrivalCorrections: 0, payrollPayslips: 0 });
    vi.mocked(loadAdminPayrollEstimates).mockResolvedValue({ items: [], employeeCount: 2, completeCount: 1, incompleteCount: 1, knownEstimatedTotal: 8037.48, completeEstimatedTotal: 3689.37 });
  });

  it('shows the same real-time payroll summary used by payroll management', async () => {
    render(
      <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('实时薪资成本')).toBeInTheDocument();
    expect(screen.getByText('到货数量')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('到货待看')).not.toBeInTheDocument();
    expect(screen.getByText('¥8,037.48')).toBeInTheDocument();
    expect(screen.getByText('数据完整 1/2')).toBeInTheDocument();
    expect(loadAdminPayrollEstimates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });
});

describe('DashboardPage notification unread count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: 'store-1', name: '测试门店' }],
      profile: { display_name: '测试员工', id: 'profile-1', role: 'staff' },
      signOut: vi.fn(),
      store: { id: 'store-1', name: '测试门店' },
      user: { email: 'staff@example.com' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadNotices).mockResolvedValue([]);
    vi.mocked(loadNotifications).mockResolvedValue([
      notification('notification-1', '第一条通知'),
      notification('notification-2', '第二条通知'),
      notification('notification-3', '第三条通知'),
    ]);
    vi.mocked(loadV2Tasks).mockResolvedValue([]);
    vi.mocked(loadTodoSummary).mockResolvedValue({ count: 0, managerPenalties: 0, payrollConfirmations: 0, noticeAcknowledgements: 0, productCreationRequests: 0, productFeedback: 0, tasks: 0, overtime: 0, attendanceCorrections: 0, arrivalCorrections: 0, payrollPayslips: 0 });
    vi.mocked(markNotificationRead).mockReturnValue(new Promise(() => undefined));
  });

  it('updates the total immediately as individual notifications are opened', async () => {
    render(
      <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('未读 3 条')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /第一条通知/ }));
    await waitFor(() => expect(screen.getByText('未读 2 条')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /第二条通知/ }));
    await waitFor(() => expect(screen.getByText('未读 1 条')).toBeInTheDocument());
    expect(markNotificationRead).toHaveBeenCalledTimes(2);
  });

  it('counts only the unread labels in the three visible notification rows', async () => {
    vi.mocked(loadNotifications).mockResolvedValue([
      notification('notification-1', '第一条通知', true),
      notification('notification-2', '第二条通知', true),
      notification('notification-3', '第三条通知', true),
      notification('notification-4', '未展示的第四条通知'),
      notification('notification-5', '未展示的第五条通知'),
    ]);

    render(
      <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('未读 0 条')).toBeInTheDocument();
    expect(screen.queryByText('未读', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('未展示的第四条通知')).not.toBeInTheDocument();
  });
});
