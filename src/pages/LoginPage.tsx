import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff, Lock, Store, User } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../features/auth/AuthContext';
import { FeedbackBanner } from '../components/ui/Feedback';
import { FormField } from '../components/ui/FormField';
import { loginSchema, type LoginFormValues } from '../features/auth/loginSchema';
import { hasSupabaseConfig } from '../lib/env';
import { systemVersion } from '../config/version';

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
      setSubmitError(error instanceof Error ? error.message : '账号或密码错误，请检查后重新输入。');
    }
  };

  const isDisabled = !hasSupabaseConfig || isSubmitting || auth.status === 'loading';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-8">
      <form className="ui-card w-full max-w-md p-6 text-slate-800 sm:p-8" onSubmit={handleSubmit(onSubmit)}>
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-100">
            <Store className="h-7 w-7 text-brand-700" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">门店运营系统</h1>
          <p className="mt-1 text-sm text-slate-500">使用门店账号安全登录</p>
        </div>

        <div className="space-y-4">
          {!hasSupabaseConfig ? (
            <FeedbackBanner tone="warning">
              当前缺少 Supabase 环境变量。复制 `.env.example` 为 `.env.local` 并填写公开 anon 配置后，登录会连接真实认证服务。
            </FeedbackBanner>
          ) : null}

          {submitError ? (
            <FeedbackBanner tone="danger">{submitError}</FeedbackBanner>
          ) : null}

          <FormField error={errors.identifier?.message} label={<span className="flex items-center gap-2">
              <User className="h-4 w-4" aria-hidden="true" />
              账号名或姓名
            </span>} required>
            <input
              autoComplete="username"
              className="ui-input"
              disabled={isDisabled}
              placeholder="请输入账号名或姓名"
              type="text"
              {...register('identifier')}
            />
          </FormField>

          <FormField error={errors.password?.message} label={<span className="flex items-center gap-2">
              <Lock className="h-4 w-4" aria-hidden="true" />
              密码
            </span>} required>
            <div className="flex min-h-11 items-center rounded-lg border border-slate-300 bg-white pl-3 transition focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
              <input
                autoComplete="current-password"
                className="min-w-0 flex-1 bg-transparent text-base outline-none"
                disabled={isDisabled}
                placeholder="请输入密码"
                type={showPassword ? 'text' : 'password'}
                {...register('password')}
              />
              <button
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500"
                disabled={isDisabled}
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
          </FormField>

          <button
            className="ui-button-primary min-h-12 w-full text-base"
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
      <p className="mt-4 text-xs font-medium text-slate-500">{systemVersion}</p>
    </main>
  );
}
