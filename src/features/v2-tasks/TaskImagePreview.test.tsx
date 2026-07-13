import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { V2TaskImageRow } from '../../services/v2-tasks.service';
import { TaskImagePreview } from './TaskImagePreview';

const image = {
  id: 'image-1',
  uploaded_by: 'profile-1',
} as V2TaskImageRow;

describe('TaskImagePreview', () => {
  it('supports fullscreen preview and deleting an editable uploaded image', () => {
    const onDelete = vi.fn();
    render(<TaskImagePreview deletableImageIds={[image.id]} imageUrls={{ [image.id]: 'blob:task-image' }} images={[image]} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: '全屏查看已上传图片 1' }));
    expect(screen.getByRole('dialog', { name: '图片全屏预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    expect(screen.queryByRole('dialog', { name: '图片全屏预览' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除已上传图片 1' }));
    expect(onDelete).toHaveBeenCalledWith(image);
  });

  it('does not show delete for an image uploaded by another account', () => {
    render(<TaskImagePreview deletableImageIds={[]} imageUrls={{ [image.id]: 'blob:task-image' }} images={[image]} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '删除已上传图片 1' })).not.toBeInTheDocument();
  });
});
