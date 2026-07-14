import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../types/database';
import { countUnreadNotifications } from './notifications.service';

describe('countUnreadNotifications', () => {
  it('uses an exact RLS-scoped count instead of counting the limited recent list', async () => {
    const eq = vi.fn().mockResolvedValue({ count: 7, error: null });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as SupabaseClient<Database>;

    await expect(countUnreadNotifications(client)).resolves.toBe(7);
    expect(from).toHaveBeenCalledWith('notifications');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(eq).toHaveBeenCalledWith('is_read', false);
  });
});
