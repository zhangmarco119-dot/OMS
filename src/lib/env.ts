const optionalEnv = (key: string): string | undefined => {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

export const appEnv = {
  supabaseUrl: optionalEnv('VITE_SUPABASE_URL'),
  supabaseAnonKey: optionalEnv('VITE_SUPABASE_ANON_KEY'),
};

export const hasSupabaseConfig = Boolean(appEnv.supabaseUrl && appEnv.supabaseAnonKey);
