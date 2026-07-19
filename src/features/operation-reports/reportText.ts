export type OperationReportField = {
  enabled?: boolean;
  id: string;
  kind: 'computed' | 'manual';
  label: string;
  required?: boolean;
  requiresPhoto?: boolean;
  unit?: string;
};

export type RefundEntry = {
  orderNumber: string;
  platform: 'meituan' | 'eleme' | 'other';
  reason: string;
  ticketId?: string;
};

const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
const labels: Record<string, (value: unknown) => string> = {
  report_date: (value) => dateLabel(String(value)),
  sales_amount: (value) => Number(value ?? 0).toFixed(2),
  transaction_count: (value) => String(Number(value ?? 0)),
  full_time_partner_count: (value) => `${Number(value ?? 0)}人`,
  total_work_hours: (value) => `${Number(value ?? 0)}小时`,
  spmh: (value) => Number(value ?? 0).toFixed(2),
};

const refundSection = (date: string, refunds: RefundEntry[], note: string) => {
  const platform = (key: RefundEntry['platform'], name: string) => {
    const entries = refunds.filter((item) => item.platform === key);
    return [
      `${name}退单总数：${entries.length || '无'}`,
      ...(entries.length ? entries.map((entry, index) => `${index + 1}. 订单号：${entry.orderNumber}${entry.reason ? ` ${entry.reason}` : ''}`) : []),
    ].join('\n');
  };
  const other = refunds.filter((item) => item.platform === 'other');
  return [
    `今日日期：${dateLabel(date)}`,
    platform('meituan', '美团'),
    platform('eleme', '饿了么'),
    ...(other.length ? [`其他渠道退单总数：${other.length}`, ...other.map((entry, index) => `${index + 1}. 订单号：${entry.orderNumber}${entry.reason ? ` ${entry.reason}` : ''}`)] : []),
    `备注：${note}`,
  ].join('\n\n');
};

export function buildOperationReportText(input: {
  computed: Record<string, unknown>;
  date: string;
  fields: OperationReportField[];
  manualValues: Record<string, string>;
  refundNote: string;
  refunds: RefundEntry[];
  title: string;
}) {
  const content = input.fields.filter((field) => field.enabled !== false).map((field) => {
    const raw = field.kind === 'manual' ? input.manualValues[field.id] ?? '' : input.computed[field.id];
    const formatted = field.kind === 'computed' && labels[field.id] ? labels[field.id](raw) : `${raw ?? ''}${field.unit ?? ''}`;
    return `${field.label}：${formatted}`;
  });
  return [input.title, ...content, '', refundSection(input.date, input.refunds, input.refundNote)].join('\n');
}
