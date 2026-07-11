import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

interface LoginPayload {
  identifier?: string;
  password?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });

const requiredEnv = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let payload: LoginPayload;
  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    return json({ error: '请求格式不正确' });
  }

  const identifier = payload.identifier?.trim() ?? '';
  const password = payload.password ?? '';
  if (!identifier || !password || identifier.length > 100 || password.length > 256) {
    return json({ error: '请输入正确的账号名或姓名和密码' });
  }

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: usernameMatches, error: usernameError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('username', identifier)
    .eq('is_active', true)
    .limit(2);

  if (usernameError) {
    return json({ error: '登录服务暂时不可用' });
  }

  let matches = usernameMatches ?? [];
  let matchedByDisplayName = false;

  if (matches.length === 0) {
    const { data: displayNameMatches, error: displayNameError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('display_name', identifier)
      .eq('is_active', true)
      .limit(2);

    if (displayNameError) {
      return json({ error: '登录服务暂时不可用' });
    }

    matches = displayNameMatches ?? [];
    matchedByDisplayName = true;
  }

  if (matchedByDisplayName && matches.length > 1) {
    return json({ error: '该姓名对应多个账号，请使用唯一账号名登录' });
  }

  if (matches.length !== 1) {
    return json({ error: '账号名或密码错误' });
  }

  const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(matches[0].id);
  const email = authUserData.user?.email;
  if (authUserError || !email) {
    return json({ error: '账号名或密码错误' });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.session) {
    return json({ error: '账号名或密码错误' });
  }

  return json({
    accessToken: signInData.session.access_token,
    refreshToken: signInData.session.refresh_token,
  });
});
