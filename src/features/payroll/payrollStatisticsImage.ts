import { formatMoney } from './model';
import type { PayrollStatistics } from '../../services/payroll-statistics.service';

const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const numericMoney = (value: number) => formatMoney(value).replace('¥', '¥ ');

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, options: { align?: CanvasTextAlign; color?: string; font?: string } = {}) {
  context.fillStyle = options.color ?? '#0f172a';
  context.font = options.font ?? '28px "Microsoft YaHei", sans-serif';
  context.textAlign = options.align ?? 'left';
  context.fillText(value, x, y);
}

export async function downloadPayrollStatisticsImage(statistics: PayrollStatistics) {
  const width = 1440;
  const storeHeight = Math.max(statistics.stores.length, 1) * 64 + 94;
  const employeeHeight = Math.max(statistics.employees.length, 1) * 58 + 94;
  const height = 410 + storeHeight + employeeHeight + 100;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成统计图表。');

  context.fillStyle = '#f1f5f9';
  context.fillRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, 250);
  gradient.addColorStop(0, '#065f46');
  gradient.addColorStop(1, '#0f766e');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, 240);
  text(context, 'StoreHub · 薪资综合统计', 70, 86, { color: '#d1fae5', font: 'bold 26px "Microsoft YaHei", sans-serif' });
  text(context, `${statistics.from}  至  ${statistics.to}`, 70, 148, { color: '#ffffff', font: 'bold 44px "Microsoft YaHei", sans-serif' });
  text(context, '薪资成本口径：收入项减处罚，不将个税作为门店用工成本', 70, 198, { color: '#a7f3d0', font: '22px "Microsoft YaHei", sans-serif' });

  const metrics = [
    ['薪资成本', numericMoney(statistics.totalSalaryCost)],
    ['总计工时', `${statistics.totalHours.toFixed(2)} h`],
    ['平均工时成本', statistics.averageHourlyCost == null ? '—' : `${numericMoney(statistics.averageHourlyCost)} / h`],
    ['总营业收入', numericMoney(statistics.totalRevenue)],
    ['全部门店薪资占比', percent(statistics.overallPayrollRatio)],
  ];
  const cardWidth = 248;
  metrics.forEach(([label, value], index) => {
    const x = 55 + index * 270;
    roundedRect(context, x, 270, cardWidth, 112, 18, '#ffffff');
    text(context, label, x + 20, 310, { color: '#64748b', font: '20px "Microsoft YaHei", sans-serif' });
    text(context, value, x + 20, 357, { color: index === 0 || index === 4 ? '#047857' : '#0f172a', font: 'bold 27px "Microsoft YaHei", sans-serif' });
  });

  let top = 420;
  roundedRect(context, 55, top, width - 110, storeHeight, 20, '#ffffff');
  text(context, '门店薪资与营收', 85, top + 48, { font: 'bold 30px "Microsoft YaHei", sans-serif' });
  const storeColumns = [85, 475, 680, 875, 1080, 1330];
  ['门店', '薪资成本', '总薪资占比', '营业收入', '薪资/营收', '工时'].forEach((label, index) => text(context, label, storeColumns[index], top + 84, { align: index ? 'right' : 'left', color: '#64748b', font: '18px "Microsoft YaHei", sans-serif' }));
  if (!statistics.stores.length) text(context, '暂无门店数据', 85, top + 135, { color: '#94a3b8', font: '22px "Microsoft YaHei", sans-serif' });
  statistics.stores.forEach((store, index) => {
    const y = top + 128 + index * 64;
    if (index % 2 === 0) roundedRect(context, 75, y - 31, width - 150, 52, 10, '#f8fafc');
    text(context, store.name, storeColumns[0], y, { font: '22px "Microsoft YaHei", sans-serif' });
    text(context, numericMoney(store.salaryCost), storeColumns[1], y, { align: 'right', font: 'bold 22px "Microsoft YaHei", sans-serif' });
    text(context, percent(store.payrollShare), storeColumns[2], y, { align: 'right', color: '#047857', font: '22px "Microsoft YaHei", sans-serif' });
    text(context, numericMoney(store.revenue), storeColumns[3], y, { align: 'right', font: '22px "Microsoft YaHei", sans-serif' });
    text(context, percent(store.payrollToRevenueRatio), storeColumns[4], y, { align: 'right', color: store.payrollToRevenueRatio != null && store.payrollToRevenueRatio > 0.3 ? '#be123c' : '#0f172a', font: 'bold 22px "Microsoft YaHei", sans-serif' });
    text(context, `${store.hours.toFixed(2)} h`, storeColumns[5], y, { align: 'right', font: '22px "Microsoft YaHei", sans-serif' });
  });

  top += storeHeight + 28;
  roundedRect(context, 55, top, width - 110, employeeHeight, 20, '#ffffff');
  text(context, `员工工资（${statistics.employees.length} 人）`, 85, top + 48, { font: 'bold 30px "Microsoft YaHei", sans-serif' });
  const employeeColumns = [85, 760, 1010, 1330];
  ['员工', '工资成本', '工时', '平均工时成本'].forEach((label, index) => text(context, label, employeeColumns[index], top + 84, { align: index ? 'right' : 'left', color: '#64748b', font: '18px "Microsoft YaHei", sans-serif' }));
  if (!statistics.employees.length) text(context, '选定时间内暂无员工工资', 85, top + 135, { color: '#94a3b8', font: '22px "Microsoft YaHei", sans-serif' });
  statistics.employees.forEach((employee, index) => {
    const y = top + 126 + index * 58;
    if (index % 2 === 0) roundedRect(context, 75, y - 29, width - 150, 48, 10, '#f8fafc');
    text(context, `${employee.displayName}${employee.employmentType === 'part_time' ? ' · 兼职' : ''}`, employeeColumns[0], y, { font: '21px "Microsoft YaHei", sans-serif' });
    text(context, numericMoney(employee.salaryCost), employeeColumns[1], y, { align: 'right', font: 'bold 21px "Microsoft YaHei", sans-serif' });
    text(context, `${employee.hours.toFixed(2)} h`, employeeColumns[2], y, { align: 'right', font: '21px "Microsoft YaHei", sans-serif' });
    text(context, employee.averageHourlyCost == null ? '—' : `${numericMoney(employee.averageHourlyCost)} / h`, employeeColumns[3], y, { align: 'right', color: '#047857', font: '21px "Microsoft YaHei", sans-serif' });
  });

  text(context, '工时口径：有效出勤按 8 小时/天，另加已审批兼职/加班工时 · 由 StoreHub 生成', 70, height - 48, { color: '#64748b', font: '20px "Microsoft YaHei", sans-serif' });

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('统计图表生成失败。')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `StoreHub_薪资综合统计_${statistics.from}_${statistics.to}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
