import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

import { DeepSeekClient } from './deepseek-client.ts';
import { createAiReviewHandler } from './handler.ts';

const requiredEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const optionalEnv = (key: string) => Deno.env.get(key)?.trim() || undefined;

const supabaseUrl = requiredEnv('SUPABASE_URL');
const anonKey = requiredEnv('SUPABASE_ANON_KEY');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const loadProviderConfig = async () => {
  try {
    const { data, error } = await serviceClient.rpc('service_get_ai_provider_config');
    if (error || !data) return null;
    return data as {
      api_key?: string;
      base_url?: string;
      model?: string;
    };
  } catch {
    return null;
  }
};

const handler = createAiReviewHandler({
  anonClient: (authorization) => createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  }),
  deepSeekClient: async () => {
    const config = await loadProviderConfig();
    const apiKey = config?.api_key?.trim() || optionalEnv('DEEPSEEK_API_KEY');
    if (!apiKey) throw new Error('Missing DEEPSEEK_API_KEY');
    return new DeepSeekClient({
      apiKey,
      baseUrl: config?.base_url || optionalEnv('DEEPSEEK_API_BASE_URL'),
      model: config?.model || undefined,
      timeoutMs: Number(optionalEnv('DEEPSEEK_TIMEOUT_MS')) || undefined,
    });
  },
  serviceClient,
  workerSecret: optionalEnv('AI_REVIEW_WORKER_SECRET'),
});

Deno.serve(handler);
