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

const handler = createAiReviewHandler({
  anonClient: (authorization) => createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  }),
  deepSeekClient: () => new DeepSeekClient({
    apiKey: requiredEnv('DEEPSEEK_API_KEY'),
    baseUrl: optionalEnv('DEEPSEEK_API_BASE_URL'),
    timeoutMs: Number(optionalEnv('DEEPSEEK_TIMEOUT_MS')) || undefined,
  }),
  serviceClient,
  workerSecret: optionalEnv('AI_REVIEW_WORKER_SECRET'),
});

Deno.serve(handler);
