import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { useAiPilotSettings } from '../features/ai-review/useAiPilotSettings';
import { AppMenuPage } from './AppMenuPage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../features/ai-review/useAiPilotSettings', () => ({ useAiPilotSettings: vi.fn() }));

describe('AppMenuPage administrator workbench', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: { role: 'admin' } } as ReturnType<typeof useAuth>);
    vi.mocked(useAiPilotSettings).mockReturnValue({ error: null, loading: false, reload: vi.fn(), settings: { adminApplyEnabled: true, adminVisible: true, autoRunEnabled: true, globalEnabled: true, pilotStores: [], workflowFlags: {} } });
  });

  it('shows independent content and administration entries without a duplicate arrival history card', () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /公告管理/ })).toHaveAttribute('href', '/app/admin/announcements');
    expect(screen.getByRole('link', { name: /SOP 管理/ })).toHaveAttribute('href', '/app/admin/sops');
    expect(screen.getByRole('link', { name: /货品管理/ })).toHaveAttribute('href', '/app/admin/products');
    expect(screen.getByRole('link', { name: /账号管理/ })).toHaveAttribute('href', '/app/admin/users');
    expect(screen.getByRole('link', { name: /考勤管理/ })).toHaveAttribute('href', '/app/admin/attendance');
    expect(screen.getByRole('link', { name: /实时薪资/ })).toHaveAttribute('href', '/app/admin/payroll');
    expect(screen.getByRole('link', { name: /AI 质检试点/ })).toHaveAttribute('href', '/app/admin/ai-review');
    expect(screen.queryByText('公告与 SOP')).not.toBeInTheDocument();
    expect(screen.queryByText('到货记录')).not.toBeInTheDocument();
  });

  it('shows the AI review entry immediately while its database settings are still loading', () => {
    vi.mocked(useAiPilotSettings).mockReturnValue({ error: null, loading: true, reload: vi.fn(), settings: null });

    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /AI 质检试点/ })).toHaveAttribute('href', '/app/admin/ai-review');
  });

  it('gives a store employee a personal attendance entry without administrator access', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { role: 'staff' } } as ReturnType<typeof useAuth>);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /我的考勤/ })).toHaveAttribute('href', '/app/attendance');
    expect(screen.getByRole('link', { name: /我的薪资/ })).toHaveAttribute('href', '/app/payroll');
    expect(screen.getByRole('link', { name: /加班管理/ })).toHaveAttribute('href', '/app/overtime');
    expect(screen.queryByRole('link', { name: /考勤管理/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /AI 质检试点/ })).not.toBeInTheDocument();
  });

  it('keeps the AI pilot invisible to store managers', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { role: 'manager' } } as ReturnType<typeof useAuth>);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /AI 质检试点/ })).not.toBeInTheDocument();
  });

  it('gives administrators an operation-log entry', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { role: 'admin' } } as ReturnType<typeof useAuth>);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /操作日志/ })).toHaveAttribute('href', '/app/admin/operation-logs');
  });

  it('labels the part-time entry as part-time work-hour submission', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { employment_type: 'part_time', role: 'staff' } } as ReturnType<typeof useAuth>);
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AppMenuPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /兼职工时填报/ })).toHaveAttribute('href', '/app/overtime?tab=submit');
  });
});
