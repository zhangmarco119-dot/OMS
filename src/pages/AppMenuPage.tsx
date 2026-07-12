import { BarChart3, Bell, BookOpenCheck, ClipboardList, History, PackageCheck, Settings, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { featureFlags } from '../config/featureFlags';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { useAuth } from '../features/auth/AuthContext';

export function AppMenuPage() {
  const auth = useAuth();
  const isAdmin = auth.profile?.role === 'admin';
  const canUseV2 = canOperateV2Modules(auth.profile?.role);
  const items = isAdmin ? [
    { icon: PackageCheck, label: '到货管理', note: '到货消息、列表与每日汇总', to: '/app/admin/arrivals' },
    { icon: ClipboardList, label: '任务管理', note: '创建、发布、审核与整改', to: '/app/admin/tasks' },
    { icon: BarChart3, label: '运营统计', note: '到货、任务、巡店与 V1 摘要', to: '/app/admin/analytics' },
    { icon: Bell, label: '公告与 SOP', note: '发布门店内容和流程手册', to: '/app/admin/content' },
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
    { icon: Settings, label: '商品与账号', note: '商品导入导出、账号设置', to: '/app/admin' },
    { icon: UserRound, label: '账号设置', note: '个人资料和密码', to: '/app/account' },
  ] : [
    ...(featureFlags.arrivalEntry && canUseV2 ? [{ icon: PackageCheck, label: '到货上报', note: '登记到货并查看本店历史', to: '/app/arrivals' }] : []),
    ...(featureFlags.taskTemplates && canUseV2 ? [{ icon: ClipboardList, label: '任务中心', note: '周清、月清、巡店和临时任务', to: '/app/tasks' }] : []),
    ...(featureFlags.noticesAndSops && canUseV2 ? [{ icon: Bell, label: '门店公告', note: '查看公告和已读状态', to: '/app/notices' }, { icon: BookOpenCheck, label: 'SOP 手册', note: '查看适用的标准作业流程', to: '/app/sops' }] : []),
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
    { icon: UserRound, label: '账号设置', note: '个人资料和密码', to: '/app/account' },
  ];
  return <PageShell eyebrow="门店运营系统" title="更多功能" backTo="/app"><section className="grid gap-3 sm:grid-cols-2">{items.map(({ icon: Icon, label, note, to }) => <Link className="flex min-h-20 items-center gap-3 rounded-lg bg-white p-4 shadow-sm active:scale-[0.99]" key={to} to={to}><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span><span className="min-w-0"><b className="block text-slate-900">{label}</b><span className="mt-1 block text-sm text-slate-500">{note}</span></span></Link>)}</section></PageShell>;
}
