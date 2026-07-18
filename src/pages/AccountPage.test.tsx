import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { AccountPage } from './AccountPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: null }));

describe('AccountPage system information entry', () => {
  const renderAccount = (role: 'admin' | 'manager' | 'staff') => {
    vi.mocked(useAuth).mockReturnValue({
      availableStores: [{ id: '00000000-0000-4000-8000-000000000002', name: '测试门店' }],
      profile: { display_name: '测试账号', id: '00000000-0000-4000-8000-000000000001', is_active: true, role, username: 'tester' },
      signOut: vi.fn(),
      store: { id: '00000000-0000-4000-8000-000000000002', name: '测试门店' },
    } as unknown as ReturnType<typeof useAuth>);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AccountPage /></MemoryRouter>);
  };

  it('links the administrator My menu to About System', () => {
    renderAccount('admin');

    expect(screen.getByRole('link', { name: /关于系统/ })).toHaveAttribute('href', '/app/account/about');
  });

  it.each(['staff', 'manager'] as const)('shows About System and the role manual to %s accounts', (role) => {
    renderAccount(role);

    expect(screen.getByRole('link', { name: /关于系统/ })).toHaveAttribute('href', '/app/account/about');
  });
});
