import { BarChart3, Bell, BookOpenCheck, ClipboardList, History, PackageCheck, PackagePlus, Settings } from 'lucide-react';
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
    { icon: PackageCheck, label: '到货管理', note: '查看到货与每日汇总', to: '/app/admin/arrivals' },
    { icon: Bell, label: '公告与 SOP', note: '发布门店内容和流程手册', to: '/app/admin/content' },
    { icon: Settings, label: '商品与账号', note: '商品导入导出与权限', to: '/app/admin' },
    { icon: BarChart3, label: '运营统计', note: '到货、任务、巡店与 V1 摘要', to: '/app/admin/analytics' },
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
  ] : [
    { icon: ClipboardList, label: '点货', note: '录入实际库存并自动保存', to: '/app/inventory' },
    { icon: PackagePlus, label: '订货', note: '填写订货数量和无需订货', to: '/app/order' },
    ...(featureFlags.arrivalEntry && canUseV2 ? [{ icon: PackageCheck, label: '到货上报', note: '登记到货并查看本店历史', to: '/app/arrivals' }] : []),
    ...(featureFlags.taskTemplates && canUseV2 ? [{ icon: ClipboardList, label: '任务中心', note: '处理周清、月清和临时任务', to: '/app/tasks' }, { icon: ClipboardList, label: '巡店', note: '进入巡店任务检查', to: '/app/tasks?category=巡店' }] : []),
    ...(featureFlags.noticesAndSops && canUseV2 ? [{ icon: Bell, label: '门店公告', note: '查看公告和已读状态', to: '/app/notices' }, { icon: BookOpenCheck, label: 'SOP 手册', note: '查看标准作业流程', to: '/app/sops' }] : []),
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
  ];
  return <PageShell eyebrow="门店运营系统" title="工作台" backTo="/app"><section className="grid grid-cols-2 gap-3">{items.map(({ icon: Icon, label, note, to }) => <Link className="flex aspect-square min-h-40 flex-col rounded-xl bg-white p-4 shadow-sm transition active:scale-[0.98]" key={to} to={to}><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-6 w-6" /></span><b className="mt-auto text-base text-slate-900">{label}</b><span className="mt-1 text-xs leading-5 text-slate-500">{note}</span></Link>)}</section></PageShell>;
}
