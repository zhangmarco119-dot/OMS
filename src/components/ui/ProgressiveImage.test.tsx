import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressiveImage } from './ProgressiveImage';

describe('ProgressiveImage', () => {
  it('shows loading until the browser finishes decoding the image', () => {
    render(<ProgressiveImage alt="到货照片" src="https://example.test/arrival.jpg" />);
    expect(screen.getByText('正在加载图片')).toBeInTheDocument();

    fireEvent.load(screen.getByAltText('到货照片'));
    expect(screen.queryByText('正在加载图片')).not.toBeInTheDocument();
  });

  it('does not report a failure while the resource URL is still resolving', () => {
    const { rerender } = render(<ProgressiveImage alt="任务照片" resourceLoading />);
    expect(screen.getByText('正在加载图片')).toBeInTheDocument();
    expect(screen.queryByText('图片预览加载失败')).not.toBeInTheDocument();

    rerender(<ProgressiveImage alt="任务照片" resourceLoading={false} />);
    expect(screen.getByText('图片预览加载失败')).toBeInTheDocument();
  });
});
