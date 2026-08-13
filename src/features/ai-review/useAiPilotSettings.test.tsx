import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAiPilotSettings } from '../../services/ai-review.service';
import { useAuth } from '../auth/AuthContext';
import { useAiPilotSettings } from './useAiPilotSettings';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../services/ai-review.service', () => ({ loadAiPilotSettings: vi.fn() }));

describe('useAiPilotSettings access boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['staff', 'manager'] as const)('does not make an AI settings request for %s accounts', async (role) => {
    vi.mocked(useAuth).mockReturnValue({ profile: { id: `${role}-1`, role } } as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useAiPilotSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings).toBeNull();
    expect(loadAiPilotSettings).not.toHaveBeenCalled();
  });

  it('loads database-backed pilot settings for an administrator', async () => {
    const settings = { adminApplyEnabled: true, adminVisible: true, autoRunEnabled: true, globalEnabled: true, pilotStores: [], workflowFlags: {} };
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } } as ReturnType<typeof useAuth>);
    vi.mocked(loadAiPilotSettings).mockResolvedValue(settings);

    const { result } = renderHook(() => useAiPilotSettings());

    await waitFor(() => expect(result.current.settings).toEqual(settings));
    expect(loadAiPilotSettings).toHaveBeenCalledWith({});
  });
});
