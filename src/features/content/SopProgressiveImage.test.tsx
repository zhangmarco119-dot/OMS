import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../types/database';
import { SopProgressiveImage } from './SopProgressiveImage';
import { loadSopImageUrl } from './sopImageDelivery';

vi.mock('./sopImageDelivery', () => ({ loadSopImageUrl: vi.fn(), invalidateSopImageUrl: vi.fn() }));
const props = { alt: '制作图', client: {} as SupabaseClient<Database>, containerClassName: 'h-20 w-20', imageClassName: 'h-full w-full', objectPath: 'one.jpg', variant: 'detail' as const };
afterEach(() => vi.restoreAllMocks());
describe('SOP independent image loading', () => {
  it('renders metadata and reserves the image while transport and decoding are pending', async () => {
    let resolve!: (url: string) => void;
    vi.mocked(loadSopImageUrl).mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    render(<><h1>已可编辑的步骤</h1><SopProgressiveImage {...props} eager /></>);
    expect(screen.getByText('已可编辑的步骤')).toBeVisible();
    expect(screen.getByText('正在加载图片')).toBeVisible();
    expect(screen.queryByText('图片预览加载失败')).not.toBeInTheDocument();
    resolve('https://example.test/one.jpg');
    await screen.findByAltText('制作图');
    expect(screen.getByText('正在加载图片')).toBeVisible();
    fireEvent.load(screen.getByAltText('制作图'));
    expect(screen.queryByText('正在加载图片')).not.toBeInTheDocument();
  });
  it('isolates a failed image and allows retry without losing page content', async () => {
    vi.mocked(loadSopImageUrl).mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('https://example.test/one.jpg');
    render(<><textarea defaultValue="未保存的说明" /><SopProgressiveImage {...props} eager /></>);
    await screen.findByText('图片预览加载失败');
    expect(screen.getByDisplayValue('未保存的说明')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }));
    await waitFor(() => expect(screen.getByAltText('制作图')).toBeInTheDocument());
    fireEvent.error(screen.getByAltText('制作图'));
    expect(screen.getByText('图片预览加载失败')).toBeVisible();
  });
});
