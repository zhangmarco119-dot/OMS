import { BarChart3, Bell, BookOpenCheck, ClipboardList, History, PackageCheck, PackagePlus, ShoppingBag, Users } from 'lucide-react';
import { PageShell } from '../components/layout/PageShell';
import { FeatureCard } from '../components/ui/Surface';
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
    { icon: Bell, label: '公告管理', note: '发布公告并查看员工已读情况', to: '/app/admin/announcements' },
    { icon: BookOpenCheck, label: 'SOP 管理', note: '制作、发布和归档作业流程', to: '/app/admin/sops' },
    { icon: ShoppingBag, label: '货品管理', note: '货品维护、导入与导出', to: '/app/admin/products' },
    { icon: Users, label: '账号管理', note: '账号资料与使用权限', to: '/app/admin/users' },
    { icon: BarChart3, label: '运营统计', note: '到货、任务、巡店与历史摘要', to: '/app/admin/analytics' },
    { icon: History, label: '点货订货记录', note: '查看已提交的点货与订货单据', to: '/app/history' },
  ] : [
    { icon: ClipboardList, label: '点货', note: '录入实际库存并自动保存', to: '/app/inventory' },
    { icon: PackagePlus, label: '订货', note: '填写订货数量和无需订货', to: '/app/order' },
    ...(featureFlags.arrivalEntry && canUseV2 ? [{ icon: PackageCheck, label: '到货上报', note: '登记到货并查看本店历史', to: '/app/arrivals' }] : []),
    ...(featureFlags.taskTemplates && canUseV2 ? [{ icon: ClipboardList, label: '任务中心', note: '处理周清、月清和临时任务', to: '/app/tasks' }] : []),
    ...(featureFlags.noticesAndSops && canUseV2 ? [{ icon: Bell, label: '门店公告', note: '查看公告和已读状态', to: '/app/notices' }, { icon: BookOpenCheck, label: 'SOP 手册', note: '查看标准作业流程', to: '/app/sops' }] : []),
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
  ];
  return <PageShell eyebrow="门店运营系统" title="工作台" contentGapClassName="gap-3"><section className="grid grid-cols-3 gap-2 sm:gap-3">{items.map((item) => <FeatureCard {...item} key={item.to} />)}</section></PageShell>;
}
