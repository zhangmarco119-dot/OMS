import { Bell, ChevronRight, CircleHelp, Eye, EyeOff, History, KeyRound, LogOut, Store, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { StatusBadge } from '../components/ui/Feedback';
import { FormField } from '../components/ui/FormField';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { loadNotices, type NoticeListItem } from '../services/v2-content.service';

const roleLabel = {
  admin: '管理员',
  manager: '店长',
  staff: '员工',
} as const;

export function AccountPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'password' ? 'password' : 'profile';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<NoticeListItem[]>([]);

  const loadNoticesForAccount = useCallback(async () => {
    if (!supabase || auth.profile?.role === 'admin') return;
    try { setNotices((await loadNotices(supabase)).filter((notice) => notice.status === 'published' && !notice.isRead)); }
    catch { setNotices([]); }
  }, [auth.profile?.role]);
  useEffect(() => { void loadNoticesForAccount(); }, [loadNoticesForAccount]);

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
      <PageShell eyebrow="账户" title="我的" contentGapClassName="gap-3.5">
        {notices.length ? <Link className="notice-ticker ui-interactive flex min-h-11 items-center gap-2 overflow-hidden rounded-2xl border border-brand-700 bg-gradient-to-r from-brand-700 to-brand-600 px-3.5 text-sm font-semibold text-white shadow-sm" to={`/app/notices/${notices[0].id}`}><Bell className="h-4 w-4 shrink-0" /><span className="notice-ticker-text">未读公告：{notices.map((notice) => notice.title).join('　·　')}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0" /></Link> : null}
        <section className="ui-card relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-700 via-brand-500 to-emerald-400" />
          <div className="flex items-center gap-3.5 border-b border-slate-100 p-4 pt-5 sm:p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
              <UserRound className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold text-ink">{auth.profile?.display_name ?? '未设置姓名'}</h2>
                <StatusBadge tone="success">{auth.profile ? roleLabel[auth.profile.role] : '未知'}</StatusBadge>
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">@{auth.profile?.username ?? '未设置账号名'}</p>
            </div>
          </div>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5"><dt className="text-slate-500">账号角色</dt><dd className="font-semibold text-ink">{auth.profile ? roleLabel[auth.profile.role] : '未知'}</dd></div>
            <div className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5"><dt className="shrink-0 text-slate-500">所属门店</dt><dd className="text-right font-semibold leading-5 text-ink">{auth.availableStores.length ? auth.availableStores.map((store) => store.name).join('、') : '未绑定门店'}</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5"><dt className="text-slate-500">账号状态</dt><dd className="font-semibold text-brand-700">{auth.profile?.is_active ? '正常' : '已停用'}</dd></div>
          </dl>
        </section>

        <section className="ui-card overflow-hidden">
          <Link className="flex min-h-14 items-center gap-3 border-b border-slate-100 px-4 text-left transition hover:bg-slate-50/80 sm:px-5" to="/app/operations-history">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><History className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <span className="flex-1 font-semibold text-ink">个人历史与运营记录</span><ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </Link>
          <button className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition hover:bg-slate-50/80 sm:px-5" onClick={() => { setMessage(null); setParams({ view: 'password' }); }} type="button">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><KeyRound className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <span className="flex-1 font-semibold text-ink">修改密码</span>
            <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </button>
          <Link className="flex min-h-14 items-center gap-3 border-t border-slate-100 px-4 text-left transition hover:bg-slate-50/80 sm:px-5" to="/app/account/about">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><CircleHelp className="h-[18px] w-[18px]" aria-hidden="true" /></span>
            <span className="flex-1 font-semibold text-ink">关于系统</span>
            <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </Link>
          <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-500 sm:px-5">
            <Store className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
            当前登录：{auth.profile?.display_name ?? auth.user?.email ?? '未知账号'}
          </div>
        </section>

        <button className="ui-button-secondary w-full border-red-200/90 text-red-700 hover:border-red-300 hover:bg-red-50" onClick={() => void auth.signOut()} type="button">
          <LogOut className="h-5 w-5" aria-hidden="true" />
          退出登录
        </button>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="账户安全" title="修改密码" backTo="/app/account">
      <div className="ui-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">设置新密码</h2>
          </div>
          <button className="ui-button-secondary" onClick={() => setShowPassword((current) => !current)} type="button">
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {showPassword ? '隐藏' : '显示'}
          </button>
        </div>
        <div className="grid gap-3">
          <FormField hint="至少 8 位，请避免使用容易猜测的密码。" label="新密码" required><input autoComplete="new-password" className="ui-input" onChange={(event) => setPassword(event.target.value)} placeholder="请输入新密码" type={showPassword ? 'text' : 'password'} value={password} /></FormField>
          <FormField label="确认新密码" required><input autoComplete="new-password" className="ui-input" onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" type={showPassword ? 'text' : 'password'} value={confirmPassword} /></FormField>
          <button className="ui-button-primary mt-1" onClick={() => void updatePassword()} type="button">
            修改密码
          </button>
        </div>
      </div>
      <ActionFeedbackDialog message={message ?? ''} onClose={() => setMessage(null)} open={Boolean(message)} title={message === '密码已修改。' ? '修改成功' : '密码未修改'} tone={message === '密码已修改。' ? 'success' : 'warning'} />
    </PageShell>
  );
}
