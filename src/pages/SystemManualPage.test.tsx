import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadSystemDocument: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/system-documents.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/system-documents.service')>();
  return { ...original, loadSystemDocument: mocks.loadSystemDocument };
});
import { SystemManualPage } from './SystemManualPage';

describe('SystemManualPage', () => {
  const createObjectUrl = vi.fn(() => 'blob:manual');
  const requestFullscreen = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mocks.loadSystemDocument.mockResolvedValue({
      audience: 'staff_manager',
      content_html: '<!doctype html><html><body><h1>在线说明正文</h1></body></html>',
      document_version: '2.2.2',
      slug: 'staff-manager-guide',
      summary: '员工与店长说明',
      title: '员工与店长使用说明',
      updated_at: '2026-07-15T08:00:00.000Z',
      updated_by: '00000000-0000-4000-8000-000000000001',
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the selected manual from the database and displays it in the embedded reader', async () => {
    render(
      <MemoryRouter initialEntries={['/app/account/about/manual/staff-manager-guide']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes><Route path="/app/account/about/manual/:manualSlug" element={<SystemManualPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('文档版本 2.2.2', { exact: false })).toBeInTheDocument();
    expect(mocks.loadSystemDocument).toHaveBeenCalledWith(expect.anything(), 'staff-manager-guide');
    expect(screen.getByTitle('员工与店长使用说明正文')).toHaveAttribute('srcdoc', expect.stringContaining('在线说明正文'));

    fireEvent.click(screen.getByRole('button', { name: '下载说明' }));
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '全屏查看' }));
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalled());
  });
});
