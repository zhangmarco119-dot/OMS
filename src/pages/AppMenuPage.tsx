import { BarChart3, Bell, BookOpenCheck, ClipboardList, History, PackageCheck, PackagePlus, ShoppingBag, Users } from 'lucide-react';
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
    { icon: ClipboardList, label: '任务管理', note: '发布、模板、周期与审核', to: '/app/admin/tasks' },
    { icon: PackageCheck, label: '到货中心', note: '到货消息、记录和汇总', to: '/app/admin/arrivals' },
    { icon: Bell, label: '公告与 SOP', note: '发布门店内容和流程手册', to: '/app/admin/content' },
    { icon: ShoppingBag, label: '商品管理', note: '商品维护、导入与导出', to: '/app/admin?tab=products' },
    { icon: Users, label: '账号管理', note: '账号资料与使用权限', to: '/app/admin?tab=users' },
    { icon: BarChart3, label: '运营统计', note: '到货、任务、巡店与 V1 摘要', to: '/app/admin/analytics' },
    { icon: History, label: '点货订货记录', note: '查看已提交的 V1 单据', to: '/app/history' },
    { icon: History, label: '到货记录', note: '查看全部到货上报记录', to: '/app/admin/arrivals' },
  ] : [
    { icon: ClipboardList, label: '点货', note: '录入实际库存并自动保存', to: '/app/inventory' },
    { icon: PackagePlus, label: '订货', note: '填写订货数量和无需订货', to: '/app/order' },
    ...(featureFlags.arrivalEntry && canUseV2 ? [{ icon: PackageCheck, label: '到货上报', note: '登记到货并查看本店历史', to: '/app/arrivals' }] : []),
    ...(featureFlags.taskTemplates && canUseV2 ? [{ icon: ClipboardList, label: '任务中心', note: '处理周清、月清和临时任务', to: '/app/tasks' }] : []),
    ...(featureFlags.noticesAndSops && canUseV2 ? [{ icon: Bell, label: '门店公告', note: '查看公告和已读状态', to: '/app/notices' }, { icon: BookOpenCheck, label: 'SOP 手册', note: '查看标准作业流程', to: '/app/sops' }] : []),
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
  ];
  return <PageShell eyebrow="门店运营系统" title="工作台" backTo="/app"><section className="grid grid-cols-3 gap-2 sm:gap-3">{items.map(({ icon: Icon, label, note, to }) => <Link className="flex aspect-square min-h-28 flex-col rounded-xl bg-brand-700 p-2.5 text-white shadow-sm ring-1 ring-brand-800 transition hover:bg-brand-800 active:scale-[0.98] sm:min-h-32 sm:p-3" key={to} to={to}><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-emerald-100 sm:h-10 sm:w-10"><Icon className="h-4 w-4 sm:h-5 sm:w-5" /></span><div className="mt-auto min-h-[3.25rem]"><b className="block text-sm leading-5 text-white sm:text-base">{label}</b><span className="mt-0.5 block min-h-8 text-[10px] leading-4 text-emerald-50/85 sm:text-xs">{note}</span></div></Link>)}</section></PageShell>;
}
