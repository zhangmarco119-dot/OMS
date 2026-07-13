import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type StoreRow = Database['public']['Tables']['stores']['Row'];

export interface AdminUserRow extends ProfileRow {
  email: string;
  productPermissions: { can_request_discontinued: boolean; can_request_incorrect: boolean; can_request_new: boolean };
  storeName: string;
  storeIds: string[];
}

export interface CreateUserInput {
  password: string;
  username: string;
  displayName: string;
  role: ProfileRow['role'];
  storeIds: string[];
}

export const findInitialAdminId = (users: AdminUserRow[]) => users
  .filter((user) => user.role === 'admin')
  .reduce<AdminUserRow | null>((oldest, user) => {
    if (!oldest) return user;
    if (user.created_at < oldest.created_at) return user;
    if (user.created_at === oldest.created_at && user.id < oldest.id) return user;
    return oldest;
  }, null)?.id ?? null;

const requireClient = () => {
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  return supabase;
};

export const loadAdminUsers = async () => {
  const client = requireClient();

  const [{ data: profiles, error: profilesError }, { data: stores, error: storesError }, accessResult, permissionsResult, authUsers] = await Promise.all([
    client.from('profiles').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    client.from('stores').select('*').order('name', { ascending: true }),
    client.from('profile_store_access').select('*'),
    client.from('profile_product_permissions').select('*'),
    invokeAdminUsers({ action: 'list-users' }) as Promise<{ users?: Array<{ id: string; email: string }> }>,
  ]);

  if (profilesError) {
    throw new Error(profilesError.message);
  }
  if (storesError) {
    throw new Error(storesError.message);
  }
  if (accessResult.error) {
    throw new Error(accessResult.error.message);
  }
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);
  const emailByProfileId = new Map((authUsers.users ?? []).map((user) => [user.id, user.email]));

  const storeMap = new Map((stores ?? []).map((store) => [store.id, store.name]));
  const permissions = new Map((permissionsResult.data ?? []).map((item) => [item.profile_id, item]));
  const storeIdsByProfile = new Map<string, string[]>();
  for (const access of accessResult.data ?? []) {
    storeIdsByProfile.set(access.profile_id, [...(storeIdsByProfile.get(access.profile_id) ?? []), access.store_id]);
  }
  const users: AdminUserRow[] = (profiles ?? []).map((profile) => ({
    ...profile,
    email: emailByProfileId.get(profile.id) ?? '',
    productPermissions: permissions.get(profile.id) ?? { can_request_discontinued: true, can_request_incorrect: true, can_request_new: true },
    storeIds: storeIdsByProfile.get(profile.id) ?? [profile.store_id],
    storeName: (storeIdsByProfile.get(profile.id) ?? [profile.store_id])
      .map((storeId) => storeMap.get(storeId) ?? '未知门店')
      .join('、'),
  }));

  return {
    users,
    stores: stores ?? [],
  };
};

export const updateProfileAdminFields = async (
  profileId: string,
  values: Pick<ProfileRow, 'role' | 'is_active'> & { storeIds: string[] },
) => {
  const client = requireClient();
  const { error } = await client
    .from('profiles')
    .update({ role: values.role, is_active: values.is_active })
    .eq('id', profileId);

  if (error) {
    throw new Error(error.message);
  }

  const { error: accessError } = await client.rpc('admin_set_profile_stores', {
    p_profile_id: profileId,
    p_store_ids: values.storeIds,
  });

  if (accessError) {
    throw new Error(accessError.message);
  }
};

export const updateProductPermissions = async (profileId: string, values: AdminUserRow['productPermissions']) => {
  const client = requireClient();
  const { error } = await client.rpc('admin_set_product_permissions', {
    p_can_request_discontinued: values.can_request_discontinued,
    p_can_request_incorrect: values.can_request_incorrect,
    p_can_request_new: values.can_request_new,
    p_profile_id: profileId,
  });
  if (error) throw new Error(error.message);
};

const invokeAdminUsers = async (body: Record<string, unknown>) => {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('admin-users', { body });

  if (error) {
    if ('context' in error && error.context instanceof Response) {
      let contextMessage: string | null = null;
      try {
        const payload = await error.context.clone().json() as { error?: unknown };
        if (typeof payload.error === 'string') {
          contextMessage = payload.error;
        }
      } catch {
        // Fall back to the standard Functions error when the response has no JSON body.
      }
      if (contextMessage) {
        throw new Error(contextMessage);
      }
    }
    throw new Error(error.message);
  }

  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    throw new Error(data.error);
  }

  return data;
};

export const createAuthUserWithProfile = (input: CreateUserInput) =>
  invokeAdminUsers({
    action: 'create-user',
    password: input.password,
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    storeIds: input.storeIds,
  });

export const setUserTemporaryPassword = (userId: string, password: string) =>
  invokeAdminUsers({
    action: 'set-password',
    userId,
    password,
  });

export const updateManagedUser = (input: { displayName: string; email?: string; password?: string; userId: string; username: string }) =>
  invokeAdminUsers({
    action: 'update-user',
    displayName: input.displayName,
    email: input.email?.trim() || undefined,
    password: input.password?.trim() || undefined,
    userId: input.userId,
    username: input.username,
  });

export const deleteManagedUser = (userId: string) =>
  invokeAdminUsers({
    action: 'delete-user',
    userId,
  });
