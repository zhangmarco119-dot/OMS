import type { ArrivalDetailRow, ArrivalProductSummaryRow } from '../../services/admin-arrivals.service';

const normalized = (value: string | null) => (value ?? '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
export const arrivalProductKey = (row: ArrivalDetailRow) => JSON.stringify([normalized(row.product_name_snapshot), normalized(row.unit)]);
export const formatArrivalDateTime = (row: ArrivalDetailRow) => `${row.arrival_date ?? '日期未记录'} ${row.arrival_time?.slice(0, 5) || '时间未填写'}`;
export const arrivalQuantity = (value: number) => Number(value.toFixed(3));

export interface ArrivalProductStatistics {
  key: string;
  name: string;
  unit: string;
  totalQuantity: number;
  reportCount: number;
  rows: ArrivalDetailRow[];
}

/** Same-name products may have different store catalogue ids; units stay separate. */
export const groupArrivalProducts = (details: ArrivalDetailRow[]): ArrivalProductStatistics[] => {
  const groups = new Map<string, ArrivalDetailRow[]>();
  for (const row of details) {
    const key = arrivalProductKey(row);
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return [...groups.entries()].map(([key, sourceRows]) => {
    const rows = [...sourceRows].sort((a, b) => `${b.arrival_date ?? ''} ${b.arrival_time ?? ''}`.localeCompare(`${a.arrival_date ?? ''} ${a.arrival_time ?? ''}`) || (a.item_id ?? '').localeCompare(b.item_id ?? ''));
    return {
      key,
      name: rows[0].product_name_snapshot ?? '未命名商品',
      unit: rows[0].unit ?? '',
      totalQuantity: arrivalQuantity(rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)),
      reportCount: new Set(rows.map((row) => row.report_id).filter(Boolean)).size,
      rows,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.unit.localeCompare(b.unit, 'zh-CN'));
};

export const summarizeArrivalDetails = (details: ArrivalDetailRow[]): ArrivalProductSummaryRow[] => {
  const stores = new Map<string | null, ArrivalDetailRow[]>();
  for (const row of details) {
    const rows = stores.get(row.store_id) ?? [];
    rows.push(row);
    stores.set(row.store_id, rows);
  }
  return [...stores.entries()].flatMap(([storeId, rows]) => groupArrivalProducts(rows).map((group) => ({
    arrival_date: null,
    product_name_snapshot: group.name,
    report_count: group.reportCount,
    store_id: storeId,
    store_name_snapshot: group.rows[0].store_name_snapshot,
    total_quantity: group.totalQuantity,
    unit: group.unit,
  })));
};
