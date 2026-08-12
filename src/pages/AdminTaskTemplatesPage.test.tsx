import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { createEmptyTaskTemplate } from '../features/task-templates/templateForm';
import {
  loadTaskTemplateDraft,
  loadTaskCategories,
  loadTaskTemplates,
  retractTaskTemplate,
  saveTaskTemplate,
  uploadTaskTemplateReferenceImage,
} from '../services/task-templates.service';
import { AdminTaskTemplatesPage } from './AdminTaskTemplatesPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/task-templates.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/task-templates.service')>();
  return {
    ...original,
    loadTaskTemplateDraft: vi.fn(),
    loadTaskCategories: vi.fn(),
    loadTaskTemplates: vi.fn(),
    retractTaskTemplate: vi.fn(),
    saveTaskTemplate: vi.fn(),
    uploadTaskTemplateReferenceImage: vi.fn(),
  };
});

describe('AdminTaskTemplatesPage reference images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: '00000000-0000-4000-8000-000000000001', name: '测试门店', short_name: '测试门店' }],
      profile: { id: '00000000-0000-4000-8000-000000000002', role: 'admin' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadTaskTemplates).mockResolvedValue([]);
    vi.mocked(loadTaskCategories).mockResolvedValue([
      { code: 'weekly_clean', label: '周清', is_system: true, created_by: null, created_at: '2026-07-01T00:00:00Z' },
    ]);
    vi.mocked(saveTaskTemplate).mockResolvedValue({ id: '00000000-0000-4000-8000-000000000003', status: 'draft' });
    vi.mocked(uploadTaskTemplateReferenceImage).mockResolvedValue({
      path: '00000000-0000-4000-8000-000000000003/item/reference.jpg',
      previewUrl: 'https://signed.example/reference.jpg',
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:reference-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('shows a local thumbnail immediately and then replaces it with the uploaded URL', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AdminTaskTemplatesPage />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '新建模板' });
    fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
    expect(screen.getByRole('dialog', { name: '未命名模板' })).toHaveClass('h-[100dvh]', 'z-50');
    expect(screen.getByRole('button', { name: '保存并发布' }).closest('.safe-bottom')).toHaveClass('fixed', 'z-[60]');
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [new File(['image'], 'reference.jpg', { type: 'image/jpeg' })] },
    });

    expect(screen.getByAltText('本地参考图待上传预览')).toHaveAttribute('src', 'blob:reference-preview');
    await waitFor(() => expect(uploadTaskTemplateReferenceImage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByAltText('参考图片 1')).toHaveAttribute('src', 'https://signed.example/reference.jpg'));
    fireEvent.click(screen.getByRole('button', { name: '全屏查看参考图片 1' }));
    const imageViewer = screen.getByRole('dialog', { name: '管理员参考图片全屏预览' });
    expect(imageViewer).toBeInTheDocument();
    fireEvent.click(within(imageViewer).getByAltText('参考图片 1'));
    expect(screen.queryByRole('dialog', { name: '管理员参考图片全屏预览' })).not.toBeInTheDocument();
  });

  it('saves an existing browser draft before uploading so newly added items exist on the server', async () => {
    const templateId = '00000000-0000-4000-8000-000000000030';
    const existing = {
      allow_overdue: false,
      category: 'weekly_clean',
      created_at: '2026-07-13T00:00:00Z',
      created_by: '00000000-0000-4000-8000-000000000002',
      current_version: 0,
      description: '',
      due_time: '20:00:00',
      id: templateId,
      name: '已有模板',
      recurrence: 'weekly',
      recurrence_day: 1,
      requires_review: true,
      status: 'draft',
      storeIds: ['00000000-0000-4000-8000-000000000001'],
      updated_at: '2026-07-13T00:00:00Z',
    } as Awaited<ReturnType<typeof loadTaskTemplates>>[number];
    const draft = createEmptyTaskTemplate(existing.storeIds);
    draft.id = templateId;
    draft.name = existing.name;
    draft.groups[0].title = '已有分组';
    draft.groups[0].items[0].label = '新增项目';
    vi.mocked(loadTaskTemplates).mockResolvedValue([existing]);
    vi.mocked(loadTaskTemplateDraft).mockResolvedValue(draft);
    vi.mocked(saveTaskTemplate).mockResolvedValue({ id: templateId, status: 'draft' });

    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AdminTaskTemplatesPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await screen.findByDisplayValue('新增项目');
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(fileInput!, {
      target: { files: [new File(['image'], 'reference.jpg', { type: 'image/jpeg' })] },
    });

    await waitFor(() => expect(saveTaskTemplate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: templateId })));
    await waitFor(() => expect(uploadTaskTemplateReferenceImage).toHaveBeenCalled());
    expect(vi.mocked(saveTaskTemplate).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(uploadTaskTemplateReferenceImage).mock.invocationCallOrder[0]);
  });

  it('shows edit, retract and disabled archive actions for a published template', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(loadTaskTemplates).mockResolvedValue([{
      allow_overdue: false,
      category: 'weekly_clean',
      created_at: '2026-07-13T00:00:00Z',
      created_by: '00000000-0000-4000-8000-000000000002',
      current_version: 2,
      description: '已发布模板',
      due_time: '20:00:00',
      id: '00000000-0000-4000-8000-000000000030',
      name: '每周清洁',
      recurrence: 'weekly',
      recurrence_day: 1,
      requires_review: true,
      status: 'published',
      storeIds: ['00000000-0000-4000-8000-000000000001'],
      updated_at: '2026-07-13T00:00:00Z',
    }]);
    vi.mocked(retractTaskTemplate).mockResolvedValue({ status: 'draft' });

    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AdminTaskTemplatesPage /></MemoryRouter>);

    const archiveButton = await screen.findByRole('button', { name: '归档每周清洁' });
    expect(screen.getByRole('button', { name: '撤回' })).toBeInTheDocument();
    expect(archiveButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '撤回' }));
    await waitFor(() => expect(retractTaskTemplate).toHaveBeenCalledWith(expect.anything(), '00000000-0000-4000-8000-000000000030'));
  });
});
