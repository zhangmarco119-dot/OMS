import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('previews a selected image immediately and includes it when saving an unsaved SOP', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { container } = render(<SopEditor
      busy={false}
      draft={{ ...createEmptySopDraft(['store-1']), title: '芒果酸奶碗' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onSave={onSave}
      stores={[{ id: 'store-1', name: '测试门店' }]}
      templates={[]}
    />);

    expect(screen.getByRole('dialog', { name: '新建制作流程' })).toHaveClass('h-[100dvh]', 'z-50');
    expect(screen.getByRole('button', { name: '发布 SOP' }).closest('.safe-bottom')).toHaveClass('fixed', 'z-[60]');

    const file = new File(['image'], 'finished-bowl.png', { type: 'image/png' });
    const input = container.querySelector('input[type="file"][accept*="image/png"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByAltText('finished-bowl.png')).toHaveAttribute('src', 'blob:sop-preview');
    expect(screen.getByText('待保存上传')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([file]));
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
});
