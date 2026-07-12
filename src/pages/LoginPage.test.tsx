import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../features/auth/AuthContext';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('renders the login form', async () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '门店运营系统' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入账号名或姓名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument());
  });
});
