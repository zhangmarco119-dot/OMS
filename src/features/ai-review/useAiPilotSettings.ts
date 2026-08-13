import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../../lib/supabase';
import { loadAiPilotSettings, type AiPilotSettings } from '../../services/ai-review.service';
import { useAuth } from '../auth/AuthContext';

export const useAiPilotSettings = () => {
  const auth = useAuth();
  const [settings, setSettings] = useState<AiPilotSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (auth.profile?.role !== 'admin' || !supabase) {
      setSettings(null);
      return;
    }
    setLoading(true);
    try {
      setSettings(await loadAiPilotSettings(supabase));
      setError(null);
    } catch (nextError) {
      setSettings(null);
      setError(nextError instanceof Error ? nextError.message : '加载 AI 试点范围失败。');
    } finally {
      setLoading(false);
    }
  }, [auth.profile?.role]);

  useEffect(() => { void reload(); }, [reload]);
  return { error, loading, reload, settings };
};
