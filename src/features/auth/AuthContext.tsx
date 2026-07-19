import type { Session, User } from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { hasSupabaseConfig } from '../../lib/env';
import { supabase } from '../../lib/supabase';
import { recordSystemActivity } from '../../services/operation-logs.service';
import type { Database } from '../../types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type StoreRow = Database['public']['Tables']['stores']['Row'];

type AuthStatus =
  | 'config-missing'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'profile-missing'
  | 'error';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  store: StoreRow | null;
  availableStores: StoreRow[];
  error: string | null;
}

interface AuthContextValue extends AuthState {
  isReady: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchStore: (storeId: string) => Promise<void>;
}

const initialState: AuthState = {
  status: hasSupabaseConfig ? 'loading' : 'config-missing',
  session: null,
  user: null,
  profile: null,
  store: null,
  availableStores: [],
  error: hasSupabaseConfig ? null : '缺少 Supabase 环境变量，无法连接认证服务。',
};

const AuthContext = createContext<AuthContextValue | null>(null);

const readProfileAndStore = async (userId: string) => {
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (!profile) {
    return { profile: null, store: null, availableStores: [] };
  }

  const { data: access, error: accessError } = await supabase
    .from('profile_store_access')
    .select('*')
    .eq('profile_id', profile.id);

  if (accessError) {
    throw new Error(accessError.message);
  }

  const storeIds = Array.from(new Set([profile.store_id, ...(access ?? []).map((item) => item.store_id)]));
  const { data: availableStores, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .in('id', storeIds)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (storeError) {
    throw new Error(storeError.message);
  }

  const stores = availableStores ?? [];
  return {
    profile,
    store: stores.find((item) => item.id === profile.store_id) ?? null,
    availableStores: stores,
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  const stateRef = useRef<AuthState>(initialState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applySession = useCallback(async (session: Session | null) => {
    if (!supabase) {
      setState(initialState);
      return;
    }

    if (!session?.user) {
      setState({
        status: 'unauthenticated',
        session: null,
        user: null,
        profile: null,
        store: null,
        availableStores: [],
        error: null,
      });
      return;
    }

    setState((current) => {
      const canKeepCurrentScreen = current.status === 'authenticated'
        && current.user?.id === session.user.id
        && Boolean(current.profile && current.store);
      return {
        ...current,
        status: canKeepCurrentScreen ? 'authenticated' : 'loading',
        session,
        user: session.user,
        error: null,
      };
    });

    try {
      const { profile, store, availableStores } = await readProfileAndStore(session.user.id);
      setState({
        status: profile && store ? 'authenticated' : 'profile-missing',
        session,
        user: session.user,
        profile,
        store,
        availableStores,
        error: profile && store ? null : '账号未绑定有效门店，请联系管理员。',
      });
    } catch (error) {
      setState({
        status: 'error',
        session,
        user: session.user,
        profile: null,
        store: null,
        availableStores: [],
        error: error instanceof Error ? error.message : '加载账号资料失败',
      });
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setState(initialState);
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }
      if (error) {
        setState({
          status: 'error',
          session: null,
          user: null,
          profile: null,
          store: null,
          availableStores: [],
          error: error.message,
        });
        return;
      }
      void applySession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const current = stateRef.current;
      if (session?.user
        && current.status === 'authenticated'
        && current.user?.id === session.user.id
        && current.profile
        && current.store) {
        // Mobile browsers pause the page while the camera or photo picker is open.
        // Supabase commonly emits SIGNED_IN/TOKEN_REFRESHED when the page resumes.
        // Keep protected routes mounted so file-input change events, previews and
        // in-flight uploads are not discarded merely because the token changed.
        setState((latest) => ({ ...latest, session, user: session.user, error: null }));
        return;
      }
      void applySession(session);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    if (!supabase) {
      setState(initialState);
      throw new Error('请先配置 Supabase 环境变量');
    }

    setState((current) => ({ ...current, status: 'loading', error: null }));
    const normalizedIdentifier = identifier.trim();

    // Keep existing Supabase Auth email accounts usable while account-login is deployed.
    if (normalizedIdentifier.includes('@')) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedIdentifier,
        password,
      });

      if (error) {
        setState({
          status: 'unauthenticated',
          session: null,
          user: null,
          profile: null,
          store: null,
          availableStores: [],
          error: '账号或密码错误',
        });
        throw new Error('账号或密码错误');
      }

      await applySession(data.session);
      await recordSystemActivity(supabase, { module: 'auth', view: 'login', context: { loginMethod: 'email' } });
      return;
    }

    const { data, error } = await supabase.functions.invoke('account-login', {
      body: { identifier: normalizedIdentifier, password },
    });

    const loginError =
      (error ? '账号登录服务暂不可用，请稍后重试' : null) ??
      (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null);

    if (loginError) {
      setState({
        status: 'unauthenticated',
        session: null,
        user: null,
        profile: null,
        store: null,
        availableStores: [],
        error: loginError,
      });
      throw new Error(loginError);
    }

    if (
      !data ||
      typeof data !== 'object' ||
      !('accessToken' in data) ||
      typeof data.accessToken !== 'string' ||
      !('refreshToken' in data) ||
      typeof data.refreshToken !== 'string'
    ) {
      throw new Error('登录服务返回了无效结果');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    });

    if (sessionError || !sessionData.session) {
      throw new Error(sessionError?.message ?? '无法建立登录会话');
    }

    await applySession(sessionData.session);
    await recordSystemActivity(supabase, { module: 'auth', view: 'login', context: { loginMethod: 'account' } });
  }, [applySession]);

  const signOut = useCallback(async () => {
    if (!supabase) {
      setState(initialState);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      setState((current) => ({ ...current, status: 'error', error: error.message }));
      throw new Error(error.message);
    }

    setState({
      status: 'unauthenticated',
      session: null,
      user: null,
      profile: null,
      store: null,
      availableStores: [],
      error: null,
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.user) {
      return;
    }
    await applySession(state.session);
  }, [applySession, state.session, state.user]);

  const switchStore = useCallback(async (storeId: string) => {
    if (!supabase || !state.session || !state.user) {
      throw new Error('需要先登录。');
    }
    if (storeId === state.store?.id) {
      return;
    }

    const { error } = await supabase.rpc('switch_current_store', { p_store_id: storeId });
    if (error) {
      throw new Error(error.message);
    }
    await applySession(state.session);
  }, [applySession, state.session, state.store?.id, state.user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isReady: state.status !== 'loading',
      signIn,
      signOut,
      refreshProfile,
      switchStore,
    }),
    [refreshProfile, signIn, signOut, state, switchStore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
