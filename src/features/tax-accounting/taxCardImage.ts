import type { TaxStoreReport } from '../../services/tax-accounting.service';

const safeFilePart = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-').trim();
export const taxCardFileName = (storeName: string, month: string) =>
  `${safeFilePart(storeName)}-${month}-税务信息.png`;

const money = (value: number) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export async function downloadTaxCardImage(report: TaxStoreReport, month: string) {
  if (report.rows.some((row) => row.amount == null)) {
    throw new Error('请先补全卡片中所有人员的本月薪资。');
  }
  const width = 1500;
  const headerHeight = 270;
  const rowHeight = 92;
  const footerHeight = 150;
  const height = headerHeight + (report.rows.length + 1) * rowHeight + footerHeight;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成报税卡片。');
  context.scale(scale, scale);
  context.fillStyle = '#f7faf8';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#0f5c45';
  context.fillRect(0, 0, width, 28);
  context.fillStyle = '#ffffff';
  context.fillRect(55, 68, width - 110, height - 118);
  context.strokeStyle = '#d6e3dc';
  context.lineWidth = 2;
  context.strokeRect(55, 68, width - 110, height - 118);

  context.textAlign = 'center';
  context.fillStyle = '#10251f';
  context.font = '700 50px "Microsoft YaHei", sans-serif';
  context.fillText('税务成本统计', width / 2, 140);
  context.font = '700 28px "Microsoft YaHei", sans-serif';
  context.fillStyle = '#176b51';
  context.fillText(report.store.name, width / 2, 195);
  context.font = '22px "Microsoft YaHei", sans-serif';
  context.fillStyle = '#61736c';
  context.fillText(`${month.replace('-', '年')}月 · 工资报税资料`, width / 2, 235);

  const x = [80, 330, 585, 1035, 1420];
  const labels = ['姓名', '薪资（元）', '身份证号', '手机号'];
  const tableTop = headerHeight;
  context.fillStyle = '#e8f4ee';
  context.fillRect(x[0], tableTop, x[4] - x[0], rowHeight);
  context.font = '700 25px "Microsoft YaHei", sans-serif';
  context.fillStyle = '#184f3e';
  labels.forEach((label, index) => context.fillText(label, (x[index] + x[index + 1]) / 2, tableTop + 57));

  report.rows.forEach((row, index) => {
    const top = tableTop + (index + 1) * rowHeight;
    context.fillStyle = index % 2 === 0 ? '#ffffff' : '#f7faf8';
    context.fillRect(x[0], top, x[4] - x[0], rowHeight);
    context.fillStyle = '#15251f';
    context.font = '24px "Microsoft YaHei", sans-serif';
    const values = [row.fullName, money(row.amount ?? 0), row.idNumber, row.phone];
    values.forEach((value, column) => context.fillText(value, (x[column] + x[column + 1]) / 2, top + 58));
  });

  context.strokeStyle = '#d6e3dc';
  for (const columnX of x) {
    context.beginPath();
    context.moveTo(columnX, tableTop);
    context.lineTo(columnX, tableTop + (report.rows.length + 1) * rowHeight);
    context.stroke();
  }
  for (let row = 0; row <= report.rows.length + 1; row += 1) {
    const y = tableTop + row * rowHeight;
    context.beginPath();
    context.moveTo(x[0], y);
    context.lineTo(x[4], y);
    context.stroke();
  }
  const footerTop = tableTop + (report.rows.length + 1) * rowHeight;
  context.textAlign = 'left';
  context.fillStyle = '#61736c';
  context.font = '22px "Microsoft YaHei", sans-serif';
  context.fillText(`共 ${report.rows.length} 人`, 80, footerTop + 68);
  context.textAlign = 'right';
  context.fillStyle = '#10251f';
  context.font = '700 30px "Microsoft YaHei", sans-serif';
  context.fillText(`薪资合计：¥${money(report.total)}`, 1420, footerTop + 70);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.96));
  if (!blob) throw new Error('报税卡片生成失败。');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = taxCardFileName(report.store.name, month);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

