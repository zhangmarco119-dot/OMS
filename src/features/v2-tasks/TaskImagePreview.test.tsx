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

    fireEvent.load(screen.getByRole('img', { name: '已上传图片 1' }));
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

  it('shows upload progress directly over a pending image', () => {
    const pending = { ...image, id: 'local-image-1', upload_progress: 75 } as V2TaskImageRow;
    render(<TaskImagePreview imageUrls={{ [pending.id]: 'blob:pending-image' }} images={[pending]} />);
    fireEvent.load(screen.getByRole('img', { name: '已上传图片 1' }));
    expect(screen.getByRole('progressbar', { name: '已上传图片 1上传进度' })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows loading while the signed image URL is still being resolved', () => {
    const { rerender } = render(<TaskImagePreview imageUrls={{}} images={[image]} loading />);

    expect(screen.getByText('正在加载图片')).toBeInTheDocument();
    expect(screen.queryByText('图片预览加载失败')).not.toBeInTheDocument();

    rerender(<TaskImagePreview imageUrls={{}} images={[image]} loading={false} />);
    expect(screen.getByText('图片预览加载失败')).toBeInTheDocument();
  });

  it('keeps showing loading until the browser finishes decoding the image', () => {
    render(<TaskImagePreview imageUrls={{ [image.id]: 'blob:task-image' }} images={[image]} />);
    const preview = screen.getByRole('img', { name: '已上传图片 1' });

    expect(screen.getByText('正在加载图片')).toBeInTheDocument();
    expect(screen.queryByText('图片预览加载失败')).not.toBeInTheDocument();
    fireEvent.load(preview);
    expect(screen.queryByText('正在加载图片')).not.toBeInTheDocument();
  });

  it('shows failure only after the browser reports a real image error', () => {
    render(<TaskImagePreview imageUrls={{ [image.id]: 'blob:broken-task-image' }} images={[image]} />);
    const preview = screen.getByRole('img', { name: '已上传图片 1' });

    fireEvent.error(preview);
    expect(screen.getByText('图片预览加载失败')).toBeInTheDocument();
    expect(screen.getByText('可稍后刷新重试')).toBeInTheDocument();
    expect(screen.queryByText('正在加载图片')).not.toBeInTheDocument();
  });
});
