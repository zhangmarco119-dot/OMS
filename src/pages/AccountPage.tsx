import { Bell, ChevronRight, CircleHelp, Eye, EyeOff, History, KeyRound, LogOut, Store, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
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
      <PageShell eyebrow="账户" title="我的" contentGapClassName="gap-3">
        {notices.length ? <Link className="notice-ticker ui-interactive flex min-h-11 items-center gap-2 overflow-hidden rounded-xl border border-brand-700 bg-brand-700 px-3 text-sm font-semibold text-white" to={`/app/notices/${notices[0].id}`}><Bell className="h-4 w-4 shrink-0" /><span className="notice-ticker-text">未读公告：{notices.map((notice) => notice.title).join('　·　')}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0" /></Link> : null}
        <section className="ui-card overflow-hidden">
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
            <div className="flex items-start justify-between gap-4 px-4 py-3"><dt className="shrink-0 text-slate-500">所属门店</dt><dd className="text-right font-semibold leading-5 text-ink">{auth.availableStores.length ? auth.availableStores.map((store) => store.name).join('、') : '未绑定门店'}</dd></div>
            <div className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-slate-500">账号状态</dt><dd className="font-semibold text-brand-700">{auth.profile?.is_active ? '正常' : '已停用'}</dd></div>
          </dl>
        </section>

        <section className="ui-card overflow-hidden">
          <Link className="flex min-h-14 items-center gap-3 border-b border-line px-4 text-left" to="/app/operations-history">
            <History className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <span className="flex-1 font-semibold text-ink">个人历史与运营记录</span><ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </Link>
          <button className="flex min-h-14 w-full items-center gap-3 px-4 text-left" onClick={() => { setMessage(null); setParams({ view: 'password' }); }} type="button">
            <KeyRound className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <span className="flex-1 font-semibold text-ink">修改密码</span>
            <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </button>
          <Link className="flex min-h-14 items-center gap-3 border-t border-line px-4 text-left" to="/app/account/about">
            <CircleHelp className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <span className="flex-1 font-semibold text-ink">关于系统</span>
            <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" />
          </Link>
          <div className="border-t border-line px-4 py-3 text-sm text-slate-500">
            <Store className="mr-2 inline h-4 w-4" aria-hidden="true" />
            当前登录：{auth.profile?.display_name ?? auth.user?.email ?? '未知账号'}
          </div>
        </section>

        <button className="ui-button-secondary w-full border-red-200 text-red-700 hover:bg-red-50" onClick={() => void auth.signOut()} type="button">
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
