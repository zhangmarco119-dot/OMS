import type { RoutePlanItem } from '../types/domain';

export const routePlan: RoutePlanItem[] = [
  { path: '/login', phase: 3, purpose: 'Supabase Auth 登录和门店识别' },
  { path: '/app', phase: 3, purpose: '登录后的门店首页' },
  { path: '/app/inventory', phase: 5, purpose: '盘点任务页面' },
  { path: '/app/order', phase: 6, purpose: '订货任务页面' },
  { path: '/app/arrivals', phase: 1, purpose: 'V2 到货上报共享执行入口和角色边界' },
  { path: '/app/arrivals/history', phase: 3, purpose: 'V2 门店到货历史' },
  { path: '/app/arrivals/:reportId/success', phase: 3, purpose: 'V2 到货提交成功页' },
  { path: '/app/history', phase: 7, purpose: '历史单据和重新导出' },
  { path: '/app/account', phase: 8, purpose: '本人修改密码' },
  { path: '/app/account/about', phase: 9, purpose: '管理员查看系统版本与更新记录' },
  { path: '/app/payroll', phase: 9, purpose: '员工查看预估薪资、工资单并完成确认' },
  { path: '/app/overtime', phase: 9, purpose: '员工填报加班并由店长审批' },
  { path: '/app/admin/payroll', phase: 9, purpose: '管理员查看工资合计并维护工资计算参数' },
  { path: '/app/admin/products', phase: 8, purpose: '独立的货品维护与 Excel 导入导出页面' },
  { path: '/app/admin/users', phase: 8, purpose: '独立的账号资料与权限管理页面' },
  { path: '/app/admin/announcements', phase: 9, purpose: '独立的管理员公告发布与已读管理页面' },
  { path: '/app/admin/sops', phase: 9, purpose: '独立的管理员 SOP 制作、发布与归档页面' },
];

export const currentPhase = 9;
