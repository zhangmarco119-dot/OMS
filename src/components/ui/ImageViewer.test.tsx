import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageViewer } from './ImageViewer';

const images = [{ alt: '第一张', url: '/one.jpg' }, { alt: '第二张', url: '/two.jpg' }];

describe('ImageViewer', () => {
  it('uses taps to close and horizontal swipes to switch images', () => {
    const close = vi.fn();
    const change = vi.fn();
    render(<ImageViewer activeIndex={0} images={images} onClose={close} onIndexChange={change} />);

    const dialog = screen.getByRole('dialog', { name: '图片全屏预览' });
    fireEvent.touchStart(dialog, { touches: [{ clientX: 240 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 120 }] });
    expect(change).toHaveBeenCalledWith(1);
    expect(close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('img', { name: '第一张' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('img', { name: '第一张' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('supports arrow keys, a visible counter, and the close button', () => {
    const close = vi.fn();
    const change = vi.fn();
    render(<ImageViewer activeIndex={1} images={images} onClose={close} onIndexChange={change} />);

    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(change).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
