import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatSopActionError } from '../features/content/sopFeedback';
import { createEmptyNoticeDraft, createEmptySopDraft } from '../services/v2-content.service';
import { NoticeEditor, SopEditor } from './AdminContentPage';

describe('SopEditor image-first workflow', () => {
  const createObjectUrl = vi.fn(() => 'blob:sop-preview');
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('previews and uploads a selected image immediately before saving the SOP form', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    let finishUpload: (() => void) | undefined;
    const onUploadImage = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishUpload = resolve; }));
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), title: '芒果酸奶碗' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onSave={onSave}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={onUploadImage}
      status="new"
      stores={[{ id: 'store-1', name: '测试门店' }]}
      templates={[]}
    />);

    expect(screen.getByRole('dialog', { name: '新建制作流程' })).toHaveClass('h-[100dvh]', 'z-50');
    expect(screen.getByRole('button', { name: '发布 SOP' }).closest('.safe-bottom')).toHaveClass('fixed', 'z-[60]');

    const file = new File(['image'], 'finished-bowl.png', { type: 'image/png' });
    const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image/png"]')).find((entry) => entry.multiple);
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByAltText('finished-bowl.png')).toHaveAttribute('src', 'blob:sop-preview');
    expect(screen.getByText(/正在上传/)).toBeInTheDocument();
    expect(onUploadImage).toHaveBeenCalledWith(file, 0, expect.any(Function));

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByText('图片仍在上传，请等待上传完成后再保存或发布。')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    finishUpload?.();
    await waitFor(() => expect(screen.queryByAltText('finished-bowl.png')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      existingSteps: [],
      pendingAssets: [],
    })));
  });

  it('keeps the local preview and offers retry when an SOP image upload fails', async () => {
    const onUploadImage = vi.fn().mockRejectedValue(new Error('网络暂时不可用'));
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), title: '草莓酸奶碗' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={onUploadImage}
      status="new"
      stores={[{ id: 'store-1', name: '测试门店' }]}
      templates={[]}
    />);

    const file = new File(['image'], 'failed.png', { type: 'image/png' });
    const stepInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image/png"]')).find((entry) => entry.multiple);
    fireEvent.change(stepInput!, { target: { files: [file] } });

    expect(await screen.findByText('网络暂时不可用')).toBeInTheDocument();
    expect(screen.getByAltText('failed.png')).toHaveAttribute('src', 'blob:sop-preview');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('shows two compact columns and moves a step through its sequence dropdown', async () => {
    const onReorderImages = vi.fn().mockResolvedValue(undefined);
    const onPublish = vi.fn().mockResolvedValue(true);
    const asset = (id: string, name: string, sortOrder: number) => ({
      asset_kind: 'step', bucket: 'v2-sop-assets', created_at: '2026-07-14T00:00:00Z', file_name: name, id,
      mime_type: 'image/jpeg', object_path: `sop-1/${name}`, signedUrl: `https://example.test/${name}`,
      size_bytes: 100, sop_id: 'sop-1', sort_order: sortOrder, step_text: `${name}说明`, uploaded_by: 'admin-1',
    });
    render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), id: 'sop-1', title: '双图步骤' }}
      errorMessage={null}
      existingAssets={[asset('image-1', '第一步.jpg', 0), asset('image-2', '第二步.jpg', 1)] as never}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={onPublish}
      onReorderImages={onReorderImages}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="draft"
      stores={[{ id: 'store-1', name: '测试门店' }]}
      templates={[]}
    />);

    const grid = screen.getByTestId('sop-step-grid');
    expect(grid).toHaveClass('grid-cols-2');
    fireEvent.change(screen.getByRole('combobox', { name: '调整 第二步.jpg 的步骤序号' }), { target: { value: '0' } });

    await waitFor(() => expect(onReorderImages).toHaveBeenCalledWith(['image-2', 'image-1']));
    expect(within(grid).getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual(['第二步.jpg', '第一步.jpg']);
    expect(screen.getByRole('checkbox', { name: /静默发布/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '发布 SOP' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ silentPublish: true })));
  });

  it('keeps a product cover separate from production steps and uploads its replacement immediately', async () => {
    let finishUpload: (() => void) | undefined;
    const onUploadCover = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishUpload = resolve; }));
    const cover = {
      asset_kind: 'cover', bucket: 'v2-sop-assets', created_at: '2026-07-14T00:00:00Z', file_name: '产品图.jpg', id: 'cover-1',
      mime_type: 'image/jpeg', object_path: 'sop-1/cover.jpg', signedUrl: 'https://example.test/cover.jpg', size_bytes: 100,
      sop_id: 'sop-1', sort_order: 0, step_text: '', uploaded_by: 'admin-1',
    };
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), category: '酸奶碗制作', id: 'sop-1', title: '产品图测试' }}
      errorMessage={null}
      existingAssets={[cover] as never}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={onUploadCover}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="draft"
      stores={[{ id: 'store-1', name: '测试门店' }]}
      templates={[]}
    />);

    expect(screen.getByAltText('产品图测试 产品图')).toHaveAttribute('src', 'https://example.test/cover.jpg');
    expect(screen.queryByTestId('sop-step-grid')).not.toBeInTheDocument();
    const productInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      .find((input) => input.accept.includes('image/png') && !input.multiple);
    expect(productInput).toBeDefined();
    const replacement = new File(['image'], '新产品图.png', { type: 'image/png' });
    fireEvent.change(productInput!, { target: { files: [replacement] } });

    expect(await screen.findByAltText('本地参考图待上传预览')).toHaveAttribute('src', 'blob:sop-preview');
    expect(onUploadCover).toHaveBeenCalledWith(replacement, expect.any(Function));
    finishUpload?.();
    await waitFor(() => expect(screen.queryByAltText('本地参考图待上传预览')).not.toBeInTheDocument());
  });

  it('keeps the announcement editor and action bar above the app navigation', () => {
    render(<NoticeEditor
      busy={false}
      draft={createEmptyNoticeDraft(['store-1'])}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onPublish={vi.fn()}
      onSave={vi.fn()}
      onUpload={vi.fn().mockResolvedValue(undefined)}
      recipients={[]}
      stores={[{ id: 'store-1', name: '测试门店' }]}
    />);

    expect(screen.getByRole('dialog', { name: '新建公告' })).toHaveClass('h-[100dvh]', 'z-50');
    expect(screen.getByRole('button', { name: '发布公告' }).closest('.safe-bottom')).toHaveClass('fixed', 'z-[60]');
  });

  it('distinguishes a publish failure from a draft save failure', () => {
    expect(formatSopActionError('publishing', new Error('database rejected publish')))
      .toBe('SOP 草稿已保存，但发布失败：database rejected publish');
    expect(formatSopActionError('saving', new Error('network unavailable')))
      .toBe('SOP 保存失败：network unavailable');
  });
});
