import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { AccountPage } from './AccountPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: null }));

describe('AccountPage system information entry', () => {
  it('links the My menu to About System', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { display_name: '测试员工', id: '00000000-0000-4000-8000-000000000001', is_active: true, role: 'staff', username: 'staff' },
      signOut: vi.fn(),
      store: { id: '00000000-0000-4000-8000-000000000002', name: '测试门店' },
    } as unknown as ReturnType<typeof useAuth>);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AccountPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /关于系统/ })).toHaveAttribute('href', '/app/account/about');
  });
});
