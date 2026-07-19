import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

interface LoginPayload {
  identifier?: string;
  password?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-storehub-contract, x-storehub-release',
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
    .select('id, display_name, username, role, employment_type, store_id')
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
      .select('id, display_name, username, role, employment_type, store_id')
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

  // Record successful account logins at the server boundary. The browser also
  // reports the event after establishing its session; the shared event key and
  // 30-second window prevent a duplicate while keeping login auditing reliable.
  const profile = matches[0];
  const eventKey = 'auth:login::::';
  const recentSince = new Date(Date.now() - 30_000).toISOString();
  const { data: recentLogs } = await adminClient
    .from('system_operation_logs')
    .select('id')
    .eq('actor_id', profile.id)
    .eq('module', 'auth')
    .eq('operation', 'login')
    .eq('metadata->>eventKey', eventKey)
    .gte('occurred_at', recentSince)
    .limit(1);
  if (!recentLogs?.length) {
    await adminClient.from('system_operation_logs').insert({
      actor_id: profile.id,
      actor_name_snapshot: profile.display_name,
      actor_username_snapshot: profile.username,
      actor_role_snapshot: profile.role,
      actor_employment_type_snapshot: profile.employment_type,
      store_id: profile.store_id,
      module: 'auth',
      operation: 'login',
      entity_type: 'auth_login',
      entity_id: profile.id,
      summary: '登录系统',
      metadata: {
        eventKey,
        viewType: 'login',
        loginMethod: matchedByDisplayName ? 'display_name' : 'account',
        pagePath: '/login',
        clientRelease: request.headers.get('x-storehub-release'),
      },
    });
  }

  return json({
    accessToken: signInData.session.access_token,
    refreshToken: signInData.session.refresh_token,
  });
});
