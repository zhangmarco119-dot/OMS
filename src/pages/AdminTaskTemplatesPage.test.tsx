import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import {
  loadTaskTemplates,
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
    loadTaskTemplates: vi.fn(),
    saveTaskTemplate: vi.fn(),
    uploadTaskTemplateReferenceImage: vi.fn(),
  };
});

describe('AdminTaskTemplatesPage reference images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: '00000000-0000-4000-8000-000000000001', name: '测试门店', short_name: '测试门店' }],
      profile: { id: '00000000-0000-4000-8000-000000000002', role: 'admin' },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(loadTaskTemplates).mockResolvedValue([]);
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
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [new File(['image'], 'reference.jpg', { type: 'image/jpeg' })] },
    });

    expect(screen.getByAltText('任务项目参考图片')).toHaveAttribute('src', 'blob:reference-preview');
    expect(screen.getByText('正在保存模板并上传参考图片…')).toBeInTheDocument();
    await waitFor(() => expect(uploadTaskTemplateReferenceImage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByAltText('任务项目参考图片')).toHaveAttribute('src', 'https://signed.example/reference.jpg'));
    expect(screen.getByText('参考图片已上传并保存')).toBeInTheDocument();
  });
});
