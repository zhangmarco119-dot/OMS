import { ChevronRight, Eye, EyeOff, KeyRound, LogOut, Store, UserRound } from 'lucide-react';
import { useState } from 'react';

import { PageShell } from '../components/layout/PageShell';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';

const roleLabel = {
  admin: '管理员',
  manager: '店长',
  staff: '员工',
} as const;

export function AccountPage() {
  const auth = useAuth();
  const [view, setView] = useState<'profile' | 'password'>('profile');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updatePassword = async () => {
    setMessage(null);
    if (!password || password.length < 8) {
      setMessage('新密码至少 8 位。');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('两次输入的密码不一致。');
      return;
    }
    if (!supabase) {
      setMessage('Supabase 未配置。');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      return;
    }

    setPassword('');
    setConfirmPassword('');
    setMessage('密码已修改。');
  };

  if (view === 'profile') {
    return (
      <PageShell eyebrow="账户" title="账户信息" backTo="/app">
        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
          <div className="flex items-center gap-3 border-b border-line p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <UserRound className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-ink">{auth.profile?.display_name ?? '未设置姓名'}</h2>
              <p className="mt-1 truncate text-sm text-slate-500">@{auth.profile?.username ?? '未设置账号名'}</p>
            </div>
          </div>
          <dl className="divide-y divide-line text-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-slate-500">账号角色</dt><dd className="font-semibold text-ink">{auth.profile ? roleLabel[auth.profile.role] : '未知'}</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-slate-500">所属门店</dt><dd className="truncate font-semibold text-ink">{auth.store?.name ?? '未绑定门店'}</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-slate-500">账号状态</dt><dd className="font-semibold text-brand-700">{auth.profile?.is_active ? '正常' : '已停用'}</dd></div>
          </dl>
        </section>

        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
          <button className="flex min-h-14 w-full items-center gap-3 px-4 text-left" onClick={() => { setMessage(null); setView('password'); }} type="button">
            <KeyRound className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <span className="flex-1 font-semibold text-ink">修改密码</span>
            <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </button>
          <div className="border-t border-line px-4 py-3 text-sm text-slate-500">
            <Store className="mr-2 inline h-4 w-4" aria-hidden="true" />
            当前登录：{auth.profile?.display_name ?? auth.user?.email ?? '未知账号'}
          </div>
        </section>

        <button className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white font-bold text-red-700" onClick={() => void auth.signOut()} type="button">
          <LogOut className="h-5 w-5" aria-hidden="true" />
          退出登录
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="账户安全" title="修改密码" onBack={() => setView('profile')}>
      <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">设置新密码</h2>
          </div>
          <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm font-semibold" onClick={() => setShowPassword((current) => !current)} type="button">
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {showPassword ? '隐藏' : '显示'}
          </button>
        </div>
        {message ? <p className="mb-4 rounded-md bg-accent-50 p-3 text-sm leading-6 text-accent-700">{message}</p> : null}
        <div className="grid gap-3">
          <input className="min-h-12 rounded-md border border-line px-3" onChange={(event) => setPassword(event.target.value)} placeholder="新密码" type={showPassword ? 'text' : 'password'} value={password} />
          <input className="min-h-12 rounded-md border border-line px-3" onChange={(event) => setConfirmPassword(event.target.value)} placeholder="确认新密码" type={showPassword ? 'text' : 'password'} value={confirmPassword} />
          <button className="min-h-12 rounded-md bg-brand-600 px-4 font-semibold text-white" onClick={() => void updatePassword()} type="button">
            修改密码
          </button>
        </div>
      </div>
    </PageShell>
  );
}
