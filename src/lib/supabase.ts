import { createClient } from '@supabase/supabase-js';

import type { Database } from '../types/database';
import { appEnv, hasSupabaseConfig } from './env';

export const supabase = hasSupabaseConfig
  ? createClient<Database>(appEnv.supabaseUrl!, appEnv.supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
