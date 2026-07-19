import { createClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';
import { releaseAwareFetch, releaseRequestHeaders } from '../config/release';
import { appEnv, hasSupabaseConfig } from './env';

export const supabase = hasSupabaseConfig
  ? createClient<Database>(appEnv.supabaseUrl!, appEnv.supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: releaseAwareFetch,
        headers: releaseRequestHeaders,
      },
    })
  : null;
