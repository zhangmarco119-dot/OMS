import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HierarchicalBackGuard } from './HierarchicalBackGuard';

vi.mock('../../features/auth/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'admin' } }) }));

function PathAndControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="path">{location.pathname}{location.search}</output>
    <Link to="/app/admin/payroll?tab=overview">打开实时工资</Link>
    <Link to="/app/admin/payroll?tab=employees">打开员工参数</Link>
    <Link to="/app/admin/payroll?tab=overview&date=2026-07-31&employee=p1">打开员工工资</Link>
    <button onClick={() => navigate(-1)} type="button">系统返回</button>
  </>;
}

describe('HierarchicalBackGuard native back behavior', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({ idx: 0 }, '', '/');
  });

  it('redirects a legacy peer-page POP to the business parent', async () => {
    render(<MemoryRouter initialEntries={['/app/workbench']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <HierarchicalBackGuard />
      <Routes><Route path="*" element={<PathAndControls />} /></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: '打开实时工资' }));
    fireEvent.click(screen.getByRole('link', { name: '打开员工参数' }));
    fireEvent.click(screen.getByRole('button', { name: '系统返回' }));
    expect(await screen.findByText('/app/workbench')).toBeInTheDocument();
  });

  it('allows native back from a detail to its exact filtered list', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=overview&date=2026-07-31']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <HierarchicalBackGuard />
      <Routes><Route path="*" element={<PathAndControls />} /></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: '打开员工工资' }));
    fireEvent.click(screen.getByRole('button', { name: '系统返回' }));
    expect(await screen.findByText('/app/admin/payroll?tab=overview&date=2026-07-31')).toBeInTheDocument();
  });

  it('does not expose an old feature page underneath a primary destination', async () => {
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=overview']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <HierarchicalBackGuard />
      <Routes><Route path="*" element={<PathAndControls />} /></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: '打开员工参数' }));
    const navigateToPrimary = screen.getByRole('link', { name: '打开实时工资' });
    navigateToPrimary.setAttribute('href', '/app/workbench');
    fireEvent.click(navigateToPrimary);
    fireEvent.click(screen.getByRole('button', { name: '系统返回' }));
    expect(await screen.findByText('/app/workbench')).toBeInTheDocument();
  });
});
