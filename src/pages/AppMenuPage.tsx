import { BarChart3, Bell, BookOpenCheck, Bot, CalendarClock, CircleDollarSign, ClipboardList, FileText, History, Landmark, PackageCheck, PackagePlus, ScrollText, ShoppingBag, Users } from 'lucide-react';
import { PageShell } from '../components/layout/PageShell';
import { FeatureCard } from '../components/ui/Surface';
import { featureFlags } from '../config/featureFlags';
import { canOperateV2Modules } from '../features/access/roleCapabilities';
import { useAiPilotSettings } from '../features/ai-review/useAiPilotSettings';
import { useAuth } from '../features/auth/AuthContext';

export function AppMenuPage() {
  const auth = useAuth();
  const aiPilot = useAiPilotSettings();
  const isAdmin = auth.profile?.role === 'admin';
  const isPartTime = auth.profile?.employment_type === 'part_time';
  const canUseV2 = canOperateV2Modules(auth.profile?.role);
  const canUseOperationReports = Boolean(auth.store?.name.includes('西直门'));
  const items = isAdmin ? [
    { icon: ClipboardList, label: '任务管理', note: '发布、模板、周期与审核', to: '/app/admin/tasks' },
    { icon: PackageCheck, label: '到货中心', note: '到货消息、记录和汇总', to: '/app/admin/arrivals' },
    { icon: Bell, label: '公告管理', note: '发布公告并查看员工已读情况', to: '/app/admin/announcements' },
    { icon: BookOpenCheck, label: 'SOP 管理', note: '制作、发布和归档作业流程', to: '/app/admin/sops' },
    { icon: ShoppingBag, label: '货品管理', note: '货品维护、导入与导出', to: '/app/admin/products' },
    { icon: Users, label: '账号管理', note: '账号资料与使用权限', to: '/app/admin/users' },
    { icon: CalendarClock, label: '考勤管理', note: '同步钉钉考勤、绑定员工与查看异常', to: '/app/admin/attendance' },
    { icon: CircleDollarSign, label: '实时薪资', note: '预估工资、参数、提成与处罚管理', to: '/app/admin/payroll' },
    { icon: Landmark, label: '税务与记账', note: '报税人员、报税卡片与门店工资成本', to: '/app/admin/tax-accounting' },
    { icon: BarChart3, label: '运营统计', note: '到货、任务、巡店与历史摘要', to: '/app/admin/analytics' },
    { icon: History, label: '点货订货记录', note: '查看已提交的点货与订货单据', to: '/app/history' },
  ] : isPartTime ? [
    { icon: CalendarClock, label: '兼职工时填报', note: '填报兼职工时并查看审批进度', to: '/app/overtime?tab=submit' },
    { icon: CircleDollarSign, label: '我的薪资', note: '查看累计兼职工时、薪资和工资单', to: '/app/payroll' },
    ...(featureFlags.noticesAndSops && canUseV2 ? [{ icon: Bell, label: '门店公告', note: '查看门店公告和已读状态', to: '/app/notices' }, { icon: BookOpenCheck, label: 'SOP 手册', note: '查看标准作业流程', to: '/app/sops' }] : []),
  ] : [
    { icon: ClipboardList, label: '点货', note: '录入实际库存并自动保存', to: '/app/inventory' },
    { icon: PackagePlus, label: '订货', note: '填写订货数量和无需订货', to: '/app/order' },
    ...(featureFlags.arrivalEntry && canUseV2 ? [{ icon: PackageCheck, label: '到货上报', note: '登记到货并查看本店历史', to: '/app/arrivals' }] : []),
    ...(featureFlags.taskTemplates && canUseV2 ? [{ icon: ClipboardList, label: '任务中心', note: '处理周清、月清和临时任务', to: '/app/tasks' }] : []),
    ...(featureFlags.noticesAndSops && canUseV2 ? [{ icon: Bell, label: '门店公告', note: '查看公告和已读状态', to: '/app/notices' }, { icon: BookOpenCheck, label: 'SOP 手册', note: '查看标准作业流程', to: '/app/sops' }] : []),
    { icon: CalendarClock, label: '我的考勤', note: '查看月度出勤、迟到与异常记录', to: '/app/attendance' },
    { icon: CircleDollarSign, label: '我的薪资', note: '查看预估薪资、工资单并完成确认', to: '/app/payroll' },
    { icon: CalendarClock, label: '加班管理', note: '填报加班并查看记录与工资汇总', to: '/app/overtime' },
    { icon: History, label: '运营历史', note: '点货、订货、到货和任务记录', to: '/app/operations-history' },
  ];
  if (isAdmin || (!isPartTime && canUseOperationReports)) {
    items.push({ icon: FileText, label: '运营报告', note: isAdmin ? '配置日报模板并查看员工提交的图文报告' : '拉取当日数据、填报物料并生成日报', to: '/app/operation-reports' });
  }
  if (isAdmin) items.push({ icon: ScrollText, label: '操作日志', note: '查看所有账号的关键业务操作记录', to: '/app/admin/operation-logs' });
  if (auth.profile?.role === 'manager') items.push({ icon: Users, label: '员工管理', note: '', to: '/app/manager/employees' });
  const aiReviewVisible = isAdmin && (aiPilot.settings === null || (aiPilot.settings.globalEnabled && aiPilot.settings.adminVisible));
  if (aiReviewVisible) items.push({ icon: Bot, label: 'AI 质检试点', note: '', to: '/app/admin/ai-review' });
  return <PageShell eyebrow="门店运营系统" title="工作台" contentGapClassName="gap-3"><section className="grid grid-cols-3 gap-2 sm:gap-3">{items.map((item) => <FeatureCard {...item} key={item.to} />)}</section></PageShell>;
}
