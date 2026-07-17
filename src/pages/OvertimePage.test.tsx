import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../features/auth/AuthContext';
import { todayInChina } from '../features/payroll/model';
import { loadMyOvertimeRequests, loadOvertimeProfiles } from '../services/payroll.service';
import { OvertimePage } from './OvertimePage';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../services/payroll.service', () => ({
  loadManagerOvertimeRequests: vi.fn().mockResolvedValue([]),
  loadMyOvertimeRequests: vi.fn(),
  loadOvertimeProfiles: vi.fn(),
  reviewOvertimeRequest: vi.fn(),
  submitOvertimeRequest: vi.fn(),
  updateOvertimeRequest: vi.fn(),
}));

describe('OvertimePage employee workflow', () => {
  beforeEach(() => {
    const today = todayInChina();
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: 'p1', role: 'staff' },
      store: { id: 's1' },
      availableStores: [{ id: 's1', name: '测试门店', short_name: '测试店' }],
    } as ReturnType<typeof useAuth>);
    vi.mocked(loadMyOvertimeRequests).mockResolvedValue([{
      id: 'o1', profile_id: 'p1', store_id: 's1', overtime_date: today,
      hours: 2, reason: '', status: 'approved', approved_hourly_rate: 25,
      reviewed_by: 'm1', reviewed_at: new Date().toISOString(), review_note: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }]);
    vi.mocked(loadOvertimeProfiles).mockResolvedValue([]);
  });

  it('separates submission and records while showing approved summaries', async () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><OvertimePage /></MemoryRouter>);

    expect(screen.getByRole('button', { name: '加班填报' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加班记录' })).toBeInTheDocument();
    expect(screen.getByLabelText('加班小时')).toHaveDisplayValue('请选择加班小时');
    expect(screen.getByRole('option', { name: '0.5 小时' })).toBeInTheDocument();
    expect(screen.getByText('加班说明（选填）')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加班记录' }));
    await waitFor(() => expect(loadMyOvertimeRequests).toHaveBeenCalled());
    expect(await screen.findByText('本月加班汇总')).toBeInTheDocument();
    expect(screen.getByText('2 小时')).toBeInTheDocument();
    expect(screen.getByText('¥50.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /申请修改/ })).toBeInTheDocument();
  });
});
