import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

type AdminAction =
  | {
      action: 'create-user';
      email?: string;
      password: string;
      displayName: string;
      username: string;
      role: 'staff' | 'manager' | 'admin';
      storeIds: string[];
    }
  | {
      action: 'set-password';
      userId: string;
      password: string;
    }
  | {
      action: 'list-users';
    }
  | {
      action: 'update-user';
      userId: string;
      username: string;
      displayName: string;
      email?: string;
      password?: string;
    }
  | {
      action: 'delete-user';
      userId: string;
    };

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

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');

  if (!authorization) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authUser, error: authError } = await userClient.auth.getUser();
  if (authError || !authUser.user) {
    return json({ error: 'Invalid session' }, 401);
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', authUser.user.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin' || callerProfile.is_active !== true) {
    return json({ error: 'Admin permission required' }, 403);
  }

  const payload = (await request.json()) as AdminAction;

  if (payload.action === 'list-users') {
    const { data, error } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    if (error) return json({ error: error.message }, 400);
    return json({ users: data.users.map((user) => ({ id: user.id, email: user.email ?? '' })) });
  }

  if (payload.action === 'create-user') {
    const email = payload.email?.trim() || `internal-${crypto.randomUUID()}@accounts.invalid`;
    const username = payload.username?.trim();

    const storeIds = Array.from(new Set(payload.storeIds ?? []));

    if (!username || !payload.displayName?.trim() || !payload.password || storeIds.length === 0) {
      return json({ error: 'Missing required account fields' }, 400);
    }

    const { data: callerStores, error: callerStoresError } = await adminClient
      .from('profile_store_access')
      .select('store_id')
      .eq('profile_id', callerProfile.id);

    if (callerStoresError) {
      return json({ error: callerStoresError.message }, 400);
    }

    const allowedStoreIds = new Set((callerStores ?? []).map((item) => item.store_id));
    if (storeIds.some((storeId) => !allowedStoreIds.has(storeId))) {
      return json({ error: '不能分配当前管理员无权访问的门店。' }, 403);
    }

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existingProfileError) {
      return json({ error: existingProfileError.message }, 400);
    }
    if (existingProfile) {
      return json({ error: '账号名已存在，请使用其他账号名。' }, 409);
    }

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        display_name: payload.displayName,
      },
    });

    if (error || !data.user) {
      return json({ error: error?.message ?? 'Failed to create user' }, 400);
    }

    const { error: profileInsertError } = await adminClient.from('profiles').insert({
      id: data.user.id,
      store_id: storeIds[0],
      username,
      display_name: payload.displayName.trim(),
      role: payload.role,
      is_active: true,
    });

    if (profileInsertError) {
      await adminClient.auth.admin.deleteUser(data.user.id, true);
      return json({ error: profileInsertError.message }, 400);
    }

    const { error: accessError } = await adminClient.from('profile_store_access').insert(
      storeIds.map((storeId) => ({ profile_id: data.user.id, store_id: storeId })),
    );

    if (accessError) {
      await adminClient.auth.admin.deleteUser(data.user.id, true);
      return json({ error: accessError.message }, 400);
    }

    return json({ userId: data.user.id });
  }

  if (payload.action === 'set-password') {
    const { error } = await adminClient.auth.admin.updateUserById(payload.userId, {
      password: payload.password,
    });

    if (error) {
      return json({ error: error.message }, 400);
    }

    return json({ ok: true });
  }

  if (payload.action === 'update-user') {
    const username = payload.username.trim();
    const displayName = payload.displayName.trim();
    const email = payload.email?.trim();
    if (!username || !displayName) return json({ error: '账号名和姓名不能为空' }, 400);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return json({ error: '邮箱格式不正确' }, 400);
    if (payload.password !== undefined && payload.password.length > 0 && payload.password.length < 6) return json({ error: '密码至少需要 6 位' }, 400);

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, username, deleted_at')
      .eq('id', payload.userId)
      .single();
    if (targetError || !target || target.deleted_at) return json({ error: targetError?.message ?? '账号不存在' }, 404);

    const { data: nameConflict, error: nameConflictError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('username', username)
      .neq('id', payload.userId)
      .maybeSingle();
    if (nameConflictError) return json({ error: nameConflictError.message }, 400);
    if (nameConflict) return json({ error: '账号名已存在，请使用其他账号名。' }, 409);

    const authUpdate: { email?: string; email_confirm?: boolean; password?: string; user_metadata: { display_name: string } } = {
      user_metadata: { display_name: displayName },
    };
    if (email) { authUpdate.email = email; authUpdate.email_confirm = true; }
    if (payload.password) authUpdate.password = payload.password;
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(payload.userId, authUpdate);
    if (authUpdateError) return json({ error: authUpdateError.message }, 400);

    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({ username, display_name: displayName })
      .eq('id', payload.userId);
    if (profileUpdateError) return json({ error: profileUpdateError.message }, 400);
    return json({ ok: true });
  }

  if (payload.action === 'delete-user') {
    if (payload.userId === callerProfile.id) {
      return json({ error: '不能删除当前正在登录的管理员账号。' }, 400);
    }

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, username, deleted_at')
      .eq('id', payload.userId)
      .single();

    if (targetError || !target) {
      return json({ error: targetError?.message ?? '账号不存在。' }, 404);
    }
    if (target.deleted_at) {
      return json({ ok: true });
    }

    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(payload.userId, true);
    if (authDeleteError) {
      return json({ error: authDeleteError.message }, 400);
    }

    const { error: profileDeleteError } = await adminClient
      .from('profiles')
      .update({
        deleted_at: new Date().toISOString(),
        is_active: false,
        username: `deleted-${payload.userId}`,
      })
      .eq('id', payload.userId);

    if (profileDeleteError) {
      return json({ error: profileDeleteError.message }, 400);
    }

    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
