import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import type { UserRole } from '../types/domain';
import { ArrivalEntryPage } from './ArrivalEntryPage';

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const setRole = (role: UserRole) => {
  vi.mocked(useAuth).mockReturnValue({
    profile: { role },
    store: { name: '测试门店' },
  } as unknown as ReturnType<typeof useAuth>);
};

describe('ArrivalEntryPage role boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['staff', 'manager'] as const)('uses the same V2 entry for %s', (role) => {
    setRole(role);
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <ArrivalEntryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '到货上报' })).toBeInTheDocument();
    expect(screen.getByText(/员工和店长共用此 V2 执行入口/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the administrator outside the store execution page', () => {
    setRole('admin');
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <ArrivalEntryPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '当前账号不能执行到货上报' })).toBeInTheDocument();
  });
});
