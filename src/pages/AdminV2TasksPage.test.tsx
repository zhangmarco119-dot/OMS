import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskTemplateDraft } from '../features/task-templates/templateForm';
import { AdminV2TaskPublishPage, AdminV2TasksPage } from './AdminV2TasksPage';

const mocks = vi.hoisted(() => ({
  loadCategories: vi.fn(),
  loadRecipients: vi.fn(),
  loadRelatedContent: vi.fn(),
  loadScheduleContent: vi.fn(),
  loadSchedules: vi.fn(),
  loadTemplateDraft: vi.fn(),
  loadTemplateDraftImages: vi.fn(),
  loadTasks: vi.fn(),
  loadTimeline: vi.fn(),
  loadTemplates: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({ availableStores: [{ id: 'store-1', name: '测试门店' }, { id: 'store-2', name: '第二门店' }] }),
}));
vi.mock('../services/task-templates.service', () => ({ loadPublishableTaskTemplates: mocks.loadTemplates, loadTaskCategories: mocks.loadCategories, loadTaskTemplateDraft: mocks.loadTemplateDraft, loadTaskTemplateDraftImageUrls: mocks.loadTemplateDraftImages, loadTaskTemplates: mocks.loadTemplates }));
vi.mock('../services/v2-tasks.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/v2-tasks.service')>();
  return { ...original, loadV2TaskRecipients: mocks.loadRecipients, loadV2TaskRelatedContentOptions: mocks.loadRelatedContent, loadV2TaskScheduleContent: mocks.loadScheduleContent, loadV2TaskSchedules: mocks.loadSchedules, loadV2TaskTimeline: mocks.loadTimeline, loadV2Tasks: mocks.loadTasks };
});

describe('AdminV2TasksPage navigation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.loadTemplates.mockResolvedValue([]);
    mocks.loadCategories.mockResolvedValue([]);
    mocks.loadTasks.mockResolvedValue([]);
    mocks.loadTimeline.mockResolvedValue([]);
    mocks.loadSchedules.mockResolvedValue([]);
    mocks.loadTemplateDraft.mockResolvedValue(null);
    mocks.loadTemplateDraftImages.mockResolvedValue(null);
    mocks.loadRecipients.mockResolvedValue([]);
    mocks.loadRelatedContent.mockResolvedValue([]);
    mocks.loadScheduleContent.mockResolvedValue({ name: '周期检查', snapshot: { groups: [], template: { category: 'closing', description: '说明' } } });
  });

  it('keeps template management and task publishing as independent entry buttons', async () => {
    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: '管理任务模板' })).toHaveAttribute('href', '/app/admin/task-templates');
    expect(screen.getByRole('link', { name: '任务发布' })).toHaveAttribute('href', '/app/admin/tasks/publish');
    expect(screen.queryByRole('heading', { name: '发布任务' })).not.toBeInTheDocument();
  });

  it('shows task and schedule data even when an auxiliary request fails', async () => {
    mocks.loadTemplates.mockRejectedValue(new Error('template timeout'));
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: '2026-09-05T14:00:00.000Z',
      id: 'active-task',
      name: '仍需完成的任务',
      publish_at: '2026-09-04T01:00:00.000Z',
      publish_notified_at: '2026-09-04T01:00:01.000Z',
      reviewed_at: null,
      schedule_id: null,
      status: 'pending',
      store_id: 'store-1',
      submitted_at: null,
      task_no: 'TASK-ACTIVE',
      updated_at: '2026-09-04T01:00:00.000Z',
    }]);
    mocks.loadSchedules.mockResolvedValue([{
      acceptance_interval_days: 1,
      acceptance_month_day: null,
      acceptance_time: '20:00:00',
      acceptance_type: 'daily',
      acceptance_weekday: null,
      assigned_profile_id: null,
      completion_mode: 'shared',
      content_name: '仍在运行的周期任务',
      due_time: '20:00:00',
      id: 'schedule-active',
      interval_days: 7,
      is_active: true,
      manager_review_enabled: false,
      month_day: null,
      next_due_at: '2026-09-06T01:00:00.000Z',
      publish_time: '09:00:00',
      recipient_group_id: 'group-1',
      schedule_type: 'interval_days',
      store_id: 'store-1',
      target_audiences: ['staff', 'manager'],
      template_id: 'template-1',
      weekdays: [],
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('仍需完成的任务')).toBeInTheDocument();
    expect(screen.getByText('仍在运行的周期任务')).toBeInTheDocument();
    expect(await screen.findByText('部分内容未加载')).toBeInTheDocument();
    expect(screen.getByText(/任务模板暂时加载失败/)).toBeInTheDocument();
  });

  it('renders the core task list before slow auxiliary data finishes', async () => {
    let finishTemplateLoad: ((value: never[]) => void) | undefined;
    mocks.loadTemplates.mockReturnValue(new Promise<never[]>((resolve) => { finishTemplateLoad = resolve; }));
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: '2026-09-05T14:00:00.000Z',
      id: 'fast-task',
      name: '优先显示的任务',
      publish_at: '2026-09-04T01:00:00.000Z',
      publish_notified_at: '2026-09-04T01:00:01.000Z',
      reviewed_at: null,
      schedule_id: null,
      status: 'pending',
      store_id: 'store-1',
      submitted_at: null,
      task_no: 'TASK-FAST',
      updated_at: '2026-09-04T01:00:00.000Z',
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('优先显示的任务')).toBeInTheDocument();
    expect(screen.queryByText('部分内容未加载')).not.toBeInTheDocument();
    await act(async () => { finishTemplateLoad?.([]); });
  });

  it('renders the task list without waiting for the schedule request', async () => {
    let finishScheduleLoad: ((value: never[]) => void) | undefined;
    mocks.loadSchedules.mockReturnValue(new Promise<never[]>((resolve) => { finishScheduleLoad = resolve; }));
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: '2026-09-05T14:00:00.000Z',
      id: 'independent-task',
      name: '不等待周期请求的任务',
      publish_at: '2026-09-04T01:00:00.000Z',
      publish_notified_at: '2026-09-04T01:00:01.000Z',
      reviewed_at: null,
      schedule_id: null,
      status: 'pending',
      store_id: 'store-1',
      submitted_at: null,
      task_no: 'TASK-INDEPENDENT',
      updated_at: '2026-09-04T01:00:00.000Z',
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('不等待周期请求的任务')).toBeInTheDocument();
    expect(screen.getByText('正在加载周期任务')).toBeInTheDocument();
    await act(async () => { finishScheduleLoad?.([]); });
  });

  it('shows the publishing form only on the dedicated task publishing page', async () => {
    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: '发布任务' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理任务模板' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '员工' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '店长' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '兼职' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /允许店长审核员工提交/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '立即发布' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '定时发布' })).not.toBeChecked();
    expect(screen.getByText('高级选项 · 关联资料或点货')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '定时发布' }));
    expect(screen.getByLabelText('定时发布时间')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('发布方式'), { target: { value: 'recurring' } });
    expect(screen.getByLabelText('首次 / 下次发布时间')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '创建周期任务时立即发布一次' })).not.toBeChecked();
  });

  it('shows an explicit template loading state before enabling published choices', async () => {
    let finishTemplateLoad: ((value: Array<{ id: string; name: string; status: string; storeIds: string[] }>) => void) | undefined;
    mocks.loadTemplates.mockReturnValue(new Promise((resolve) => { finishTemplateLoad = resolve; }));

    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);

    const selector = await screen.findByLabelText('任务模板');
    expect(selector).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认发布' })).toBeDisabled();
    expect(screen.getByRole('option', { name: '正在加载任务模板…' })).toBeInTheDocument();
    expect(screen.getByText('模板读取完成后即可选择。')).toBeInTheDocument();

    await act(async () => {
      finishTemplateLoad?.([{ id: 'template-1', name: '门店设备采集', status: 'published', storeIds: ['store-1'] }]);
    });

    expect(selector).toBeEnabled();
    expect(screen.getByRole('button', { name: '确认发布' })).toBeEnabled();
    expect(screen.getByRole('option', { name: '门店设备采集' })).toBeInTheDocument();
  });

  it('shows a template retry immediately even if another auxiliary request is still pending', async () => {
    let finishRelatedContentLoad: ((value: never[]) => void) | undefined;
    mocks.loadTemplates.mockRejectedValue(new Error('template request failed'));
    mocks.loadRelatedContent.mockReturnValue(new Promise<never[]>((resolve) => { finishRelatedContentLoad = resolve; }));

    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);

    expect(await screen.findByRole('button', { name: '模板加载失败，点击重试' })).toBeInTheDocument();
    expect(screen.getByLabelText('任务模板')).toBeDisabled();
    await act(async () => { finishRelatedContentLoad?.([]); });
  });

  it('disables stores outside the selected template and explains how to enable them', async () => {
    mocks.loadTemplates.mockResolvedValue([{
      id: 'template-1',
      name: '点货',
      status: 'published',
      storeIds: ['store-1'],
    }]);

    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('任务模板'), { target: { value: 'template-1' } });

    expect(screen.getByRole('checkbox', { name: '测试门店' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: '第二门店' })).toBeDisabled();
    expect(screen.getByText(/灰色门店请先到“任务模板”中增加后再发布/)).toBeInTheDocument();
  });

  it('previews the employee task page before publishing and does not wait for reference images', async () => {
    const template = { id: 'template-1', name: '设备参数采集', status: 'published', storeIds: ['store-1'] };
    const metadataDraft: TaskTemplateDraft = {
      allowOverdue: false,
      category: 'inspection',
      description: '登记设备尺寸和电气参数',
      dueTime: '',
      groups: [{
        description: '逐台核对铭牌',
        id: 'group-1',
        items: [{
          fieldType: 'short_text',
          guidance: '填写长宽高',
          id: 'item-1',
          imageRequirement: 'single',
          isRequired: true,
          label: '操作台冰箱1',
          minimumImageCount: 2,
          optionsText: '',
          referenceImagePath: 'template-1/item-1/reference.jpg',
          referenceImagePaths: ['template-1/item-1/reference.jpg'],
          referenceImageUrl: null,
          referenceImageUrls: [],
        }],
        title: '设备信息',
      }],
      id: 'template-1',
      name: '设备参数采集',
      recurrence: 'none',
      recurrenceDay: null,
      requiresReview: true,
      storeIds: ['store-1'],
    };
    let finishImages: ((draft: TaskTemplateDraft) => void) | undefined;
    mocks.loadTemplates.mockResolvedValue([template]);
    mocks.loadTemplateDraft.mockResolvedValue(metadataDraft);
    mocks.loadTemplateDraftImages.mockReturnValue(new Promise((resolve) => { finishImages = resolve; }));

    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('任务模板'), { target: { value: 'template-1' } });
    fireEvent.click(screen.getByRole('button', { name: '预览任务' }));

    const preview = await screen.findByRole('dialog', { name: '任务员工页面预览' });
    expect(preview).toHaveTextContent('设备参数采集');
    expect(preview).toHaveTextContent('设备信息');
    expect(preview).toHaveTextContent('操作台冰箱1');
    expect(preview).toHaveTextContent('填写长宽高');
    expect(preview).toHaveTextContent('图片要求：至少上传 1 张');
    expect(preview).toHaveTextContent('正在加载图片');

    await act(async () => { finishImages?.({ ...metadataDraft, groups: metadataDraft.groups.map((group) => ({ ...group, items: group.items.map((item) => ({ ...item, referenceImageUrl: 'https://signed.example/reference.jpg', referenceImageUrls: ['https://signed.example/reference.jpg'] })) })) }); });
    expect(screen.getByAltText('参考图片 1')).toHaveAttribute('src', 'https://signed.example/reference.jpg');
    fireEvent.click(screen.getByRole('button', { name: '关闭任务预览' }));
    expect(screen.queryByRole('dialog', { name: '任务员工页面预览' })).not.toBeInTheDocument();
  });

  it('lets administrators explicitly select multiple people for independent completion', async () => {
    mocks.loadRecipients.mockResolvedValue([
      { display_name: '员工甲', employment_type: 'full_time', id: 'profile-1', role: 'staff', store_id: 'store-1', username: 'staff-a' },
      { display_name: '店长乙', employment_type: 'full_time', id: 'profile-2', role: 'manager', store_id: 'store-2', username: 'manager-b' },
    ]);

    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('完成方式'), { target: { value: 'selected' } });

    fireEvent.click(screen.getByRole('checkbox', { name: '选择员工甲' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择店长乙' }));

    expect(screen.getByText('已选择 2 人；系统会为每个人分别创建独立任务。')).toBeInTheDocument();
  });

  it('searches related SOPs in a popup and orders them by latest publication time', async () => {
    mocks.loadTemplates.mockResolvedValue([{
      id: 'template-1',
      name: '新品练习',
      status: 'published',
      storeIds: ['store-1'],
    }]);
    mocks.loadRelatedContent.mockResolvedValue([
      {
        id: 'sop-old',
        publishedAt: '2026-07-01T09:00:00.000Z',
        roles: ['staff', 'manager'],
        storeIds: ['store-1'],
        subtitle: '酸奶碗',
        title: '旧版蓝莓碗',
        type: 'sop',
      },
      {
        id: 'sop-new',
        publishedAt: '2026-07-30T09:00:00.000Z',
        roles: ['staff', 'manager'],
        storeIds: ['store-1'],
        subtitle: '酸奶碗',
        title: '新版芒果碗',
        type: 'sop',
      },
    ]);

    render(<MemoryRouter><AdminV2TaskPublishPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('任务模板'), { target: { value: 'template-1' } });
    fireEvent.click(screen.getByText('高级选项 · 关联资料或点货'));
    fireEvent.change(screen.getByLabelText('关联资料类型'), { target: { value: 'sop' } });
    fireEvent.click(screen.getByRole('button', { name: '请选择关联SOP' }));

    const choices = screen.getAllByRole('button', { name: /版.*碗/ });
    expect(choices.map((choice) => choice.textContent)).toEqual([
      expect.stringContaining('新版芒果碗'),
      expect.stringContaining('旧版蓝莓碗'),
    ]);

    fireEvent.change(screen.getByPlaceholderText('搜索SOP名称或分类'), { target: { value: '蓝莓' } });
    expect(screen.getByRole('button', { name: /旧版蓝莓碗/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /新版芒果碗/ })).not.toBeInTheDocument();
  });

  it('separates completed tasks and provides time, store, category, and search filters', async () => {
    const finishedAt = new Date();
    finishedAt.setHours(10, 0, 0, 0);
    mocks.loadCategories.mockResolvedValue([{ code: 'closing', label: '打烊任务' }]);
    mocks.loadTasks.mockResolvedValue([
      {
        assigned_profile_id: null,
        category: 'closing',
        due_at: finishedAt.toISOString(),
        id: 'completed-task',
        name: '每日打烊',
        reviewed_at: finishedAt.toISOString(),
        schedule_id: null,
        status: 'approved',
        store_id: 'store-1',
        submitted_at: finishedAt.toISOString(),
        task_no: 'TASK-001',
        updated_at: finishedAt.toISOString(),
      },
      {
        assigned_profile_id: null,
        category: 'closing',
        due_at: finishedAt.toISOString(),
        id: 'active-task',
        name: '仍在进行',
        reviewed_at: null,
        schedule_id: null,
        status: 'pending',
        store_id: 'store-1',
        submitted_at: null,
        task_no: 'TASK-002',
        updated_at: finishedAt.toISOString(),
      },
    ]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByRole('tab', { name: '进行中任务 1' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '已完成任务 1' }));

    expect(screen.getByRole('heading', { name: '已完成任务' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /每日打烊/ })).toHaveAttribute('href', '/app/admin/tasks/completed-task');
    expect(screen.queryByText('仍在进行')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '选择某日' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '选择某月' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '选择时间区间' })).toBeInTheDocument();
    expect(screen.getByLabelText('门店')).toHaveValue('');
    expect(screen.getByLabelText('任务分类')).toHaveValue('');
    expect(screen.getByRole('option', { name: '打烊任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('搜索任务')).toBeInTheDocument();
  });

  it('shows the exact planned time for a single task waiting for scheduled publication', async () => {
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: '2026-08-01T14:00:00.000Z',
      id: 'scheduled-task',
      name: '定时打烊检查',
      publish_at: '2026-08-01T10:30:00.000Z',
      publish_notified_at: null,
      reviewed_at: null,
      schedule_id: null,
      status: 'pending',
      store_id: 'store-1',
      submitted_at: null,
      task_no: 'TASK-SCHEDULED',
      updated_at: '2026-07-31T10:00:00.000Z',
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('待发布')).toBeInTheDocument();
    expect(screen.getByText('定时发布')).toBeInTheDocument();
    expect(screen.getByText(/定时发布 2026\/8\/1 18:30:00/)).toBeInTheDocument();
  });

  it('shows publication, correction, and overdue states together', async () => {
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: 'profile-1',
      category: 'cleaning',
      due_at: '2020-08-01T14:00:00.000Z',
      id: 'rejected-task',
      name: '清洗工服',
      publish_at: '2020-08-01T01:00:00.000Z',
      publish_notified_at: '2020-08-01T01:00:05.000Z',
      reviewed_at: '2020-08-02T01:00:00.000Z',
      schedule_id: 'schedule-1',
      status: 'rejected',
      store_id: 'store-1',
      submitted_at: '2020-08-01T10:00:00.000Z',
      task_no: 'TASK-REJECTED',
      updated_at: '2020-08-02T01:00:00.000Z',
    }]);
    mocks.loadRecipients.mockResolvedValue([{ display_name: '李天欣', employment_type: 'full_time', id: 'profile-1', role: 'manager', store_id: 'store-1', username: 'manager-a' }]);
    mocks.loadTimeline.mockResolvedValue([
      { action: 'submitted', created_at: '2020-08-01T10:00:00.000Z', id: 'review-1', task_id: 'rejected-task' },
      { action: 'rejected', created_at: '2020-08-01T11:00:00.000Z', id: 'review-2', task_id: 'rejected-task' },
      { action: 'resubmitted', created_at: '2020-08-01T12:00:00.000Z', id: 'review-3', task_id: 'rejected-task' },
    ]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('已发布')).toBeInTheDocument();
    expect(screen.getByText('退回整改')).toBeInTheDocument();
    expect(screen.getByText('已逾期')).toBeInTheDocument();
    expect(screen.getByText('提交与整改时间')).toBeInTheDocument();
    expect(screen.getByText('首次提交')).toBeInTheDocument();
    expect(screen.getByText('驳回')).toBeInTheDocument();
    expect(screen.getByText('第 1 次重新提交')).toBeInTheDocument();
    expect(screen.getByText('2020/8/1 18:00:00')).toBeInTheDocument();
    expect(screen.getByText('2020/8/1 19:00:00')).toBeInTheDocument();
    expect(screen.getByText('2020/8/1 20:00:00')).toBeInTheDocument();
  });

  it('allows the completion method to be changed while editing a recurring task', async () => {
    mocks.loadRecipients.mockResolvedValue([
      { display_name: '员工甲', employment_type: 'full_time', id: 'profile-1', role: 'staff', store_id: 'store-1', username: 'staff-a' },
      { display_name: '员工乙', employment_type: 'full_time', id: 'profile-2', role: 'staff', store_id: 'store-1', username: 'staff-b' },
    ]);
    mocks.loadSchedules.mockResolvedValue([{
      acceptance_interval_days: 1,
      acceptance_month_day: null,
      acceptance_time: '20:00:00',
      acceptance_type: 'daily',
      acceptance_weekday: null,
      assigned_profile_id: null,
      completion_mode: 'shared',
      content_name: '周期检查',
      content_snapshot: null,
      due_time: '20:00:00',
      id: 'schedule-1',
      interval_days: 3,
      inventory_category_codes: [],
      is_active: true,
      manager_review_enabled: false,
      month_day: null,
      next_due_at: '2026-08-04T01:00:00.000Z',
      publish_time: '09:00:00',
      recipient_group_id: 'group-1',
      related_notice_id: null,
      related_sop_id: null,
      requires_inventory: false,
      schedule_type: 'interval_days',
      store_id: 'store-1',
      target_audiences: ['staff', 'manager'],
      template_id: 'template-1',
      weekdays: [],
      withdrawn_at: null,
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));

    const completionMethod = await screen.findByLabelText('周期任务完成方式');
    expect(completionMethod).toHaveValue('shared');
    fireEvent.change(completionMethod, { target: { value: 'selected' } });
    expect(screen.getByText('指定人员（可多选）')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择员工甲' })).toBeInTheDocument();
  });

  it('shows the submitter in small text on a pending-review task card', async () => {
    mocks.loadRecipients.mockResolvedValue([{ display_name: '员工甲', employment_type: 'full_time', id: 'profile-1', role: 'staff', store_id: 'store-1', username: 'staff-a' }]);
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: 'profile-1',
      category: 'closing',
      due_at: '2026-08-03T14:00:00.000Z',
      id: 'submitted-task',
      name: '闭店检查',
      publish_at: '2026-08-02T10:00:00.000Z',
      publish_notified_at: '2026-08-02T10:00:00.000Z',
      reviewed_at: null,
      schedule_id: null,
      status: 'submitted',
      store_id: 'store-1',
      submitted_at: '2026-08-02T12:00:00.000Z',
      submitted_by: 'profile-1',
      task_no: 'TASK-REVIEW',
      updated_at: '2026-08-02T12:00:00.000Z',
    }]);

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);

    expect(await screen.findByText('提交人：员工甲')).toHaveClass('text-xs');
  });

  it('keeps the completed-task view and filters when the task list is opened again', async () => {
    const finishedAt = new Date();
    mocks.loadTasks.mockResolvedValue([{
      assigned_profile_id: null,
      category: 'closing',
      due_at: finishedAt.toISOString(),
      id: 'completed-task',
      name: '每日打烊',
      reviewed_at: finishedAt.toISOString(),
      schedule_id: null,
      status: 'approved',
      store_id: 'store-1',
      submitted_at: finishedAt.toISOString(),
      task_no: 'TASK-001',
      updated_at: finishedAt.toISOString(),
    }]);

    const first = render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: '已完成任务 1' }));
    fireEvent.change(screen.getByLabelText('门店'), { target: { value: 'store-1' } });
    first.unmount();

    render(<MemoryRouter><AdminV2TasksPage /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: '已完成任务 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('门店')).toHaveValue('store-1');
  });
});
