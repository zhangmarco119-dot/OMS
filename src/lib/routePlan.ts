import type { RoutePlanItem } from '../types/domain';

export const routePlan: RoutePlanItem[] = [
  { path: '/login', phase: 3, purpose: 'Supabase Auth 登录和门店识别' },
  { path: '/app', phase: 3, purpose: '登录后的门店首页' },
  { path: '/app/inventory', phase: 5, purpose: '盘点任务页面' },
  { path: '/app/order', phase: 6, purpose: '订货任务页面' },
  { path: '/app/history', phase: 7, purpose: '历史单据和重新导出' },
  { path: '/app/account', phase: 8, purpose: '本人修改密码' },
  { path: '/app/admin', phase: 8, purpose: '商品、Excel 导入和用户维护' },
];

export const currentPhase = 9;
