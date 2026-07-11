import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff, Lock, Store, User } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../features/auth/AuthContext';
import { loginSchema, type LoginFormValues } from '../features/auth/loginSchema';
import { hasSupabaseConfig } from '../lib/env';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const from =
    typeof location.state === 'object' && location.state && 'from' in location.state
      ? String(location.state.from)
      : '/app';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: '',
      password: '',
    },
  });

  if (auth.status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      await auth.signIn(values.identifier, values.password);
      navigate(from, { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '登录失败');
    }
  };

  const isDisabled = !hasSupabaseConfig || isSubmitting || auth.status === 'loading';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-500 to-brand-700 px-6 py-8">
      <form className="w-full max-w-md rounded-2xl bg-white p-8 text-slate-800 shadow-2xl" onSubmit={handleSubmit(onSubmit)}>
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 rounded-full bg-brand-100 p-3">
            <Store className="h-10 w-10 text-brand-600" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold">门店盘点订货系统</h1>
          <p className="mt-2 text-sm text-slate-500">请登录以继续</p>
        </div>

        <div className="space-y-6">
          {!hasSupabaseConfig ? (
            <div className="rounded-md border border-accent-500 bg-accent-50 p-3 text-sm leading-6 text-accent-700">
              当前缺少 Supabase 环境变量。复制 `.env.example` 为 `.env.local` 并填写公开 anon 配置后，登录会连接真实认证服务。
            </div>
          ) : null}

          {auth.error && auth.status !== 'config-missing' ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{auth.error}</div>
          ) : null}

          {submitError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{submitError}</div>
          ) : null}

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <User className="h-4 w-4" aria-hidden="true" />
              账号名或姓名
            </span>
            <input
              autoComplete="username"
              className="min-h-12 w-full rounded-lg border border-slate-300 px-4 text-base outline-none transition focus:border-transparent focus:ring-2 focus:ring-brand-500"
              disabled={isDisabled}
              placeholder="请输入账号名或姓名"
              type="text"
              {...register('identifier')}
            />
            {errors.identifier ? <p className="mt-2 text-sm text-red-700">{errors.identifier.message}</p> : null}
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Lock className="h-4 w-4" aria-hidden="true" />
              密码
            </span>
            <div className="flex min-h-12 items-center rounded-lg border border-slate-300 px-3 transition focus-within:border-transparent focus-within:ring-2 focus-within:ring-brand-500">
              <input
                autoComplete="current-password"
                className="min-w-0 flex-1 text-base outline-none"
                disabled={isDisabled}
                placeholder="请输入密码"
                type={showPassword ? 'text' : 'password'}
                {...register('password')}
              />
              <button
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                className="flex min-h-11 min-w-11 items-center justify-center text-slate-500"
                disabled={isDisabled}
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
            {errors.password ? <p className="mt-2 text-sm text-red-700">{errors.password.message}</p> : null}
          </label>

          <button
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-bold text-white shadow-lg shadow-brand-100 transition active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isDisabled}
            type="submit"
          >
            {isSubmitting || auth.status === 'loading' ? (
              '登录中'
            ) : (
              <>
                登录
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
