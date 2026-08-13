import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import {
  loadProductCreationRequests,
  reviewProductCreationRequest,
  type ProductCreationRequestRecord,
} from '../features/admin/adminProductsService';
import { TodoPage } from './TodoPage';

const mocks = vi.hoisted(() => ({
  loadAdminPayrollConfirmationTodos: vi.fn(),
  loadAllOvertimeRequests: vi.fn(),
  loadManagerOvertimeRequests: vi.fn(),
  loadOvertimeProfiles: vi.fn(),
  loadPendingArrivalCorrections: vi.fn(),
  loadProductFeedbackRecords: vi.fn(),
  loadTodoSummary: vi.fn(),
  loadV2TaskRecipients: vi.fn(),
  loadV2Tasks: vi.fn(),
  loadV2TaskTimeline: vi.fn(),
}));

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/v2-tasks/useTaskDeadlineClock', () => ({ useTaskDeadlineClock: () => new Date('2026-08-13T00:00:00Z') }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/admin/adminProductsService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../features/admin/adminProductsService')>();
  return {
    ...original,
    handleProductFeedbackBatchActions: vi.fn(),
    loadProductCreationRequests: vi.fn(),
    loadProductFeedbackRecords: mocks.loadProductFeedbackRecords,
    reviewProductCreationRequest: vi.fn(),
  };
});
vi.mock('../services/arrivals.service', () => ({ loadPendingArrivalCorrections: mocks.loadPendingArrivalCorrections }));
vi.mock('../services/payroll.service', () => ({
  loadAllOvertimeRequests: mocks.loadAllOvertimeRequests,
  loadManagerOvertimeRequests: mocks.loadManagerOvertimeRequests,
  loadOvertimeProfiles: mocks.loadOvertimeProfiles,
}));
vi.mock('../services/todo.service', () => ({
  completeAdminPayrollConfirmationTodo: vi.fn(),
  completeAttendanceCorrectionTodo: vi.fn(),
  loadAdminPayrollConfirmationTodos: mocks.loadAdminPayrollConfirmationTodos,
  loadMyAttendanceCorrectionTodos: vi.fn(),
  loadMyPayrollPayslipTodos: vi.fn(),
  loadTodoSummary: mocks.loadTodoSummary,
}));
vi.mock('../services/v2-content.service', () => ({ loadNotices: vi.fn() }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return {
    ...original,
    loadV2TaskRecipients: mocks.loadV2TaskRecipients,
    loadV2Tasks: mocks.loadV2Tasks,
    loadV2TaskTimeline: mocks.loadV2TaskTimeline,
  };
});

const requestRecord = {
  creatorName: '门店员工',
  request: {
    category_code: 'other_food',
    count_unit: '袋',
    id: 'request-1',
    name: '原始名称',
    spec: '100g',
    status: 'pending',
    store_id: 'store-1',
  },
  storeName: '五道口店',
} as unknown as ProductCreationRequestRecord;

const renderTodo = (role: 'admin' | 'manager') => {
  vi.mocked(useAuth).mockReturnValue({
    availableStores: [{ id: 'store-1', name: '五道口店' }],
    profile: { id: `${role}-1`, role },
    store: { id: 'store-1' },
  } as unknown as ReturnType<typeof useAuth>);

  return render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={[{
        pathname: '/app/todos',
        state: {
          aiProductCreationReview: {
            draftPatch: { name: '规范名称', spec: '200g' },
            requestId: 'request-1',
            storeId: 'store-1',
            suggestionId: 'suggestion-1',
          },
        },
      }]}
    >
      <Routes><Route element={<TodoPage />} path="/app/todos" /></Routes>
    </MemoryRouter>,
  );
};

describe('TodoPage AI product creation draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadV2Tasks.mockResolvedValue([]);
    mocks.loadTodoSummary.mockResolvedValue({ productFeedback: 0 });
    mocks.loadProductFeedbackRecords.mockResolvedValue([]);
    mocks.loadAllOvertimeRequests.mockResolvedValue([]);
    mocks.loadManagerOvertimeRequests.mockResolvedValue([]);
    mocks.loadOvertimeProfiles.mockResolvedValue([]);
    mocks.loadV2TaskRecipients.mockResolvedValue([]);
    mocks.loadV2TaskTimeline.mockResolvedValue([]);
    mocks.loadPendingArrivalCorrections.mockResolvedValue([]);
    mocks.loadAdminPayrollConfirmationTodos.mockResolvedValue([]);
    vi.mocked(loadProductCreationRequests).mockResolvedValue([requestRecord]);
  });

  it('opens the matching administrator approval draft without approving or creating anything', async () => {
    renderTodo('admin');

    const dialog = await screen.findByRole('dialog', { name: '编辑并审核新增货品' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('已带入 AI 建议')).toBeInTheDocument();
    expect(screen.getByLabelText('货品名称')).toHaveValue('规范名称');
    expect(screen.getByLabelText('规格')).toHaveValue('200g');
    expect(screen.getByLabelText('单位')).toHaveValue('袋');
    expect(screen.getByLabelText('分类')).toHaveValue('other_food');
    expect(reviewProductCreationRequest).not.toHaveBeenCalled();
  });

  it('keeps the AI draft invisible and unopened for a manager account', async () => {
    renderTodo('manager');

    await waitFor(() => expect(loadProductCreationRequests).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: '编辑并审核新增货品' })).not.toBeInTheDocument();
    expect(screen.queryByText('已带入 AI 建议')).not.toBeInTheDocument();
    expect(reviewProductCreationRequest).not.toHaveBeenCalled();
  });
});
