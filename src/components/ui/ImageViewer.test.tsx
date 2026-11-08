import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from './ImageViewer';

const images = [{ alt: '第一张', url: '/one.jpg' }, { alt: '第二张', url: '/two.jpg' }];
const touch = (x: number, y = 100) => ({ clientX: x, clientY: y });

describe('ImageViewer', () => {
  afterEach(() => vi.useRealTimers());
  it('closes after a single tap and zooms instead of closing on a double tap', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<ImageViewer activeIndex={0} images={images} onClose={close} onIndexChange={vi.fn()} />);
    const image = screen.getByRole('img', { name: '第一张' });
    fireEvent.click(image, { clientX: 200, clientY: 200 });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(image, { clientX: 200, clientY: 200 });
    act(() => vi.advanceTimersByTime(350));
    expect(close).not.toHaveBeenCalled();
    expect(image.style.transform).toContain('scale(2)');
    fireEvent.click(image);
    act(() => vi.advanceTimersByTime(350));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('pinches to zoom, drags the zoomed image, and does not switch or close', () => {
    vi.useFakeTimers();
    const close = vi.fn(); const change = vi.fn();
    render(<ImageViewer activeIndex={0} images={images} onClose={close} onIndexChange={change} />);
    const dialog = screen.getByRole('dialog', { name: '图片全屏预览' });
    const image = screen.getByRole('img', { name: '第一张' });
    Object.defineProperty(image, 'offsetWidth', { value: 1000 });
    Object.defineProperty(image, 'offsetHeight', { value: 1000 });
    fireEvent.touchStart(dialog, { touches: [touch(100), touch(200)] });
    fireEvent.touchMove(dialog, { touches: [touch(50), touch(250)] });
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [touch(50), touch(250)] });
    expect(image.style.transform).toContain('scale(2)');
    fireEvent.touchStart(dialog, { touches: [touch(200)] });
    fireEvent.touchMove(dialog, { touches: [touch(260)] });
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [touch(260)] });
    expect(image.style.transform).toMatch(/translate\((?!0px)/);
    act(() => vi.advanceTimersByTime(350));
    expect(change).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
  it('switches images on a swipe at normal scale and supports controls', () => {
    const close = vi.fn(); const change = vi.fn();
    render(<ImageViewer activeIndex={1} images={images} onClose={close} onIndexChange={change} />);
    const dialog = screen.getByRole('dialog', { name: '图片全屏预览' });
    fireEvent.touchStart(dialog, { touches: [touch(240)] });
    fireEvent.touchMove(dialog, { touches: [touch(120)] });
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [touch(120)] });
    expect(change).toHaveBeenCalledWith(0);
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(change).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('recognizes double touch without a synthetic click closing the image', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<ImageViewer activeIndex={0} images={images} onClose={close} onIndexChange={vi.fn()} />);
    const dialog = screen.getByRole('dialog'); const image = screen.getByRole('img', { name: '第一张' });
    for (let i = 0; i < 2; i++) {
      fireEvent.touchStart(dialog, { touches: [touch(100)] });
      fireEvent.touchEnd(dialog, { touches: [], changedTouches: [touch(100)] });
      fireEvent.click(image);
    }
    act(() => vi.advanceTimersByTime(350));
    expect(image.style.transform).toContain('scale(2)');
    expect(close).not.toHaveBeenCalled();
  });
  it('closes on one touch and resets zoom when the selected image changes', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const { rerender } = render(<ImageViewer activeIndex={0} images={images} onClose={close} onIndexChange={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('img', { name: '第一张' }));
    fireEvent.click(screen.getByRole('img', { name: '第一张' }));
    rerender(<ImageViewer activeIndex={1} images={images} onClose={close} onIndexChange={vi.fn()} />);
    expect(screen.getByRole('img', { name: '第二张' }).style.transform).toContain('scale(1)');
    fireEvent.touchStart(dialog, { touches: [touch(100)] });
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [touch(100)] });
    act(() => vi.advanceTimersByTime(350));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
