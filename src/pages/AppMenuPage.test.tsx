import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { AppMenuPage } from './AppMenuPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));

describe('AppMenuPage administrator workbench', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: { role: 'admin' } } as ReturnType<typeof useAuth>);
  });

  it('shows independent content and administration entries without a duplicate arrival history card', () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /公告管理/ })).toHaveAttribute('href', '/app/admin/announcements');
    expect(screen.getByRole('link', { name: /SOP 管理/ })).toHaveAttribute('href', '/app/admin/sops');
    expect(screen.getByRole('link', { name: /货品管理/ })).toHaveAttribute('href', '/app/admin/products');
    expect(screen.getByRole('link', { name: /账号管理/ })).toHaveAttribute('href', '/app/admin/users');
    expect(screen.queryByText('公告与 SOP')).not.toBeInTheDocument();
    expect(screen.queryByText('到货记录')).not.toBeInTheDocument();
  });
});
