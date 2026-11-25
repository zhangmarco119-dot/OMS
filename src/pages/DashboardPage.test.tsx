import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { loadAdminOperationOverview } from '../services/admin-operation-overview.service';
import { loadNotifications, markNotificationRead, type UserNotification } from '../services/notifications.service';
import { loadAdminPayrollEstimates } from '../services/payroll.service';
import { loadPayrollStatistics } from '../services/payroll-statistics.service';
import { loadStoreClosures } from '../services/store-business.service';
import { loadTodoSummary } from '../services/todo.service';
import { loadV2Analytics } from '../services/v2-analytics.service';
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
vi.mock('../services/payroll-statistics.service', () => ({ loadPayrollStatistics: vi.fn() }));
vi.mock('../services/store-business.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/store-business.service')>();
  return { ...original, loadStoreClosures: vi.fn() };
});
vi.mock('../services/todo.service', () => ({ loadTodoSummary: vi.fn() }));
vi.mock('../services/v2-analytics.service', () => ({ loadV2Analytics: vi.fn() }));
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

describe('DashboardPage administrator operation overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [
        { id: 'store-1', name: '五道口店' },
        { id: 'store-2', name: '西直门店' },
      ],
      profile: { display_name: '管理员', id: 'admin-1', role: 'admin' },
      signOut: vi.fn(),
      store: { id: 'store-1', name: '五道口店' },
      user: { email: 'admin@example.com' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadAdminOperationOverview).mockResolvedValue({ arrival_pending: 1, arrival_today: 2, inventory_completed_today: 3, inventory_pending: 0, v2_task_active: 4, v2_task_completed: 5 });
    vi.mocked(loadTodoSummary).mockResolvedValue({ count: 0, managerPenalties: 0, payrollConfirmations: 0, noticeAcknowledgements: 0, productCreationRequests: 0, productFeedback: 0, tasks: 0, overtime: 0, attendanceCorrections: 0, arrivalCorrections: 0, payrollPayslips: 0 });
    vi.mocked(loadAdminPayrollEstimates).mockResolvedValue({ items: [], employeeCount: 2, completeCount: 1, incompleteCount: 1, knownEstimatedTotal: 8037.48, completeEstimatedTotal: 3689.37 });
    vi.mocked(loadPayrollStatistics).mockResolvedValue({
      averageHourlyCost: 26.5,
      employees: [],
      from: '2026-11-01',
      overallPayrollRatio: 0.215,
      stores: [
        { averageHourlyCost: 26.5, hours: 300, name: '五道口店', payrollShare: 1, payrollToRevenueRatio: 0.215, revenue: 37383.63, salaryCost: 8037.48, storeId: 'store-1' },
      ],
      to: '2026-11-26',
      totalHours: 300,
      totalRevenue: 37383.63,
      totalSalaryCost: 8037.48,
    });
    vi.mocked(loadStoreClosures).mockResolvedValue([
      { closed_from: '2026-10-01', id: 'closure-1', reopened_from: null, resume_sales_sync: false, store_id: 'store-2', updated_at: '2026-10-31T00:00:00Z', updated_by: 'admin-1' },
    ]);
    vi.mocked(loadV2Analytics).mockResolvedValue({
      arrival: {
        pending: 1,
        product_kinds: 14,
        quantity_total: 86,
        stores: 1,
        today: 6,
        trend: [
          { count: 2, date: '2026-11-25' },
          { count: 4, date: '2026-11-26' },
        ],
      },
      inspection: {
        correction_completion_rate: 100,
        frequent_issues: [{ count: 2, label: '冷柜温度核对' }],
        issue_count: 2,
      },
      tasks: {
        approved: 8,
        completion_rate: 80,
        overdue: 1,
        pending: 1,
        rejected: 0,
        store_rates: [{ approved: 8, rate: 80, store_id: 'store-1', store_name: '五道口店', total: 10 }],
        submitted: 0,
      },
      v1: { inventory_submissions: 3, open_inventory: 0, order_submissions: 2 },
    });
  });

  it('shows the same real-time payroll summary used by payroll management', async () => {
    render(
      <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('数据完整 1/2')).toBeInTheDocument();
    const payrollCard = screen.getByRole('link', { name: /实时薪资成本/ });
    expect(within(payrollCard).getByText('¥8,037.48')).toBeInTheDocument();
    expect(screen.getByText('到货数量')).toBeInTheDocument();
    expect(screen.queryByText('到货待看')).not.toBeInTheDocument();
    expect(loadAdminPayrollEstimates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });

  it('displays revenue ratio, store operating status, todo breakdown, and switches trend periods', async () => {
    vi.mocked(loadTodoSummary).mockResolvedValue({
      count: 5,
      managerPenalties: 1,
      payrollConfirmations: 0,
      noticeAcknowledgements: 0,
      productCreationRequests: 1,
      productFeedback: 1,
      tasks: 2,
      overtime: 0,
      attendanceCorrections: 0,
      arrivalCorrections: 0,
      payrollPayslips: 0,
    });

    render(
      <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('人力占比 21.5%')).toBeInTheDocument();
    expect(screen.getByText('待审批 5 项')).toBeInTheDocument();
    expect(screen.getByText('逾期任务 1 项')).toBeInTheDocument();
    expect(screen.getByText('任务审核')).toBeInTheDocument();
    expect(screen.getByText('在营')).toBeInTheDocument();
    expect(screen.getByText('已关店')).toBeInTheDocument();
    expect(screen.getByText('1. 冷柜温度核对')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '本月' }));
    await waitFor(() => expect(loadV2Analytics).toHaveBeenCalledTimes(2));
    expect(screen.getByText('本月任务状态分布')).toBeInTheDocument();
  });

  it('keeps core KPIs visible when secondary trend analytics fail', async () => {
    vi.mocked(loadV2Analytics).mockRejectedValue(new Error('趋势接口暂时不可用'));

    render(
      <MemoryRouter initialEntries={['/app']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('数据完整 1/2')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /实时薪资成本/ })).getByText('¥8,037.48')).toBeInTheDocument();
    expect(await screen.findByText('趋势接口暂时不可用')).toBeInTheDocument();
    expect(screen.getByText('到货数量')).toBeInTheDocument();
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
