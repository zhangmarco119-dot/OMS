import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authListener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  from: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('../../lib/env', () => ({ hasSupabaseConfig: true }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: mocks.from,
  },
}));

import { AuthProvider } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';

const userId = '00000000-0000-4000-8000-000000000001';
const storeId = '00000000-0000-4000-8000-000000000002';
const session = {
  access_token: 'access-1',
  expires_at: 9999999999,
  expires_in: 3600,
  refresh_token: 'refresh-1',
  token_type: 'bearer',
  user: { id: userId },
} as Session;

function UploadProbe() {
  const [name, setName] = useState('未选择');
  return <label>参考图状态<input aria-label="参考图状态" onChange={(event) => setName(event.target.value)} value={name} /></label>;
}

describe('AuthProvider mobile resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authListener = null;
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    mocks.onAuthStateChange.mockImplementation((listener: (event: AuthChangeEvent, nextSession: Session | null) => void) => {
      mocks.authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: userId, is_active: true, role: 'admin', store_id: storeId }, error: null }) }) }) }) };
      }
      if (table === 'profile_store_access') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'stores') {
        return { select: () => ({ in: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: storeId, is_active: true, name: '测试门店' }], error: null }) }) }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
  });

  it('keeps protected upload UI mounted when the same session refreshes after the photo picker', async () => {
    render(
      <AuthProvider>
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <ProtectedRoute><UploadProbe /></ProtectedRoute>
        </MemoryRouter>
      </AuthProvider>,
    );

    const input = await screen.findByLabelText('参考图状态');
    fireEvent.change(input, { target: { value: '本地预览仍在' } });
    await waitFor(() => expect(mocks.authListener).not.toBeNull());

    const refreshed = { ...session, access_token: 'access-2' } as Session;
    act(() => mocks.authListener?.('TOKEN_REFRESHED', refreshed));

    expect(screen.queryByText('正在加载账号和门店信息')).not.toBeInTheDocument();
    expect(screen.getByLabelText('参考图状态')).toHaveValue('本地预览仍在');
  });
});
