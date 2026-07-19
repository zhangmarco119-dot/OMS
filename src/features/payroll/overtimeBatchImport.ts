import * as XLSX from 'xlsx';

export interface OvertimeImportProfile {
  display_name: string;
  employment_type: 'full_time' | 'part_time';
  id: string;
  is_active: boolean;
  role: 'staff' | 'manager' | 'admin';
  store_id: string;
  username: string;
}

export interface OvertimeImportStore {
  id: string;
  name: string;
  short_name?: string | null;
}

export interface OvertimeImportRow {
  employeeName: string;
  hours: number;
  overtimeDate: string;
  reason: string;
  rowNumber: number;
  storeName: string;
  username: string;
}

export interface OvertimeImportFailure {
  item: string;
  reason: string;
}

export interface OvertimeImportResult {
  failed: number;
  failures: OvertimeImportFailure[];
  succeeded: number;
  total: number;
}

type RecordOvertime = (input: {
  hours: number;
  overtimeDate: string;
  profileId: string;
  reason?: string;
  storeId: string;
}) => Promise<unknown>;

const normalize = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

const readFileAsArrayBuffer = (file: File) => {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取加班工时 Excel 文件失败。'));
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('加班工时 Excel 文件格式无效。'));
    reader.readAsArrayBuffer(file);
  });
};

const readCell = (row: unknown[], headers: string[], aliases: string[]) => {
  const aliasSet = new Set(aliases.map(normalize));
  const index = headers.findIndex((header) => aliasSet.has(normalize(header)));
  return index >= 0 ? row[index] : '';
};

const formatDatePart = (value: number) => String(value).padStart(2, '0');

const parseExcelDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${formatDatePart(value.getMonth() + 1)}-${formatDatePart(value.getDate())}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${formatDatePart(parsed.m)}-${formatDatePart(parsed.d)}`;
  }
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})(?:日)?$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) return '';
  return `${year}-${formatDatePart(month)}-${formatDatePart(day)}`;
};

export async function parseOvertimeImportFile(file: File): Promise<OvertimeImportRow[]> {
  const workbook = XLSX.read(await readFileAsArrayBuffer(file), { cellDates: true, type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Excel 中没有可读取的工作表。');
  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { defval: '', header: 1, raw: true });
  if (!table.length) throw new Error('Excel 内容为空，请使用系统模板填写。');
  const headers = table[0].map((value) => String(value ?? '').trim());
  const requiredHeaderGroups = [
    ['员工账号', '账号名', 'username'],
    ['门店', '门店名称', 'store'],
    ['加班日期', '日期', 'overtime_date'],
    ['加班工时', '工时', '小时', 'hours'],
  ];
  const missingHeaders = requiredHeaderGroups.filter((aliases) => !headers.some((header) => aliases.map(normalize).includes(normalize(header))));
  if (missingHeaders.length) throw new Error(`Excel 缺少必要列：${missingHeaders.map((aliases) => aliases[0]).join('、')}。`);

  return table.slice(1).flatMap((rawRow, index) => {
    if (rawRow.every((value) => !String(value ?? '').trim())) return [];
    const hoursValue = readCell(rawRow, headers, ['加班工时', '工时', '小时', 'hours']);
    return [{
      employeeName: String(readCell(rawRow, headers, ['员工姓名', '姓名', 'display_name'])).trim(),
      hours: typeof hoursValue === 'number' ? hoursValue : Number(String(hoursValue).trim()),
      overtimeDate: parseExcelDate(readCell(rawRow, headers, ['加班日期', '日期', 'overtime_date'])),
      reason: String(readCell(rawRow, headers, ['登记说明', '说明', '原因', 'reason'])).trim(),
      rowNumber: index + 2,
      storeName: String(readCell(rawRow, headers, ['门店', '门店名称', 'store'])).trim(),
      username: String(readCell(rawRow, headers, ['员工账号', '账号名', 'username'])).trim(),
    }];
  });
}

const resolveProfile = (row: OvertimeImportRow, profiles: OvertimeImportProfile[]) => {
  const byUsername = profiles.find((profile) => normalize(profile.username) === normalize(row.username));
  if (byUsername) {
    if (row.employeeName && normalize(byUsername.display_name) !== normalize(row.employeeName)) {
      throw new Error(`员工账号与姓名不匹配，账号“${row.username}”对应“${byUsername.display_name}”。`);
    }
    return byUsername;
  }
  if (!row.username && row.employeeName) {
    const matches = profiles.filter((profile) => normalize(profile.display_name) === normalize(row.employeeName));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('存在同名员工，请填写员工账号。');
  }
  throw new Error(`未找到员工账号“${row.username || '空'}”。`);
};

const resolveStore = (row: OvertimeImportRow, stores: OvertimeImportStore[]) => {
  const matches = stores.filter((store) => [store.id, store.name, store.short_name].some((value) => value && normalize(value) === normalize(row.storeName)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`门店名称“${row.storeName}”不唯一，请使用完整门店名称。`);
  throw new Error(`未找到门店“${row.storeName || '空'}”。`);
};

export async function importAdminOvertimeRows(input: {
  onProgress?: (completed: number, total: number) => void;
  profiles: OvertimeImportProfile[];
  recordOvertime: RecordOvertime;
  rows: OvertimeImportRow[];
  stores: OvertimeImportStore[];
  today: string;
}): Promise<OvertimeImportResult> {
  const failures: OvertimeImportFailure[] = [];
  let succeeded = 0;
  let completed = 0;
  const availableProfiles = input.profiles.filter((profile) => profile.is_active && profile.employment_type === 'full_time' && (profile.role === 'staff' || profile.role === 'manager'));

  for (const row of input.rows) {
    const item = `Excel 第 ${row.rowNumber} 行${row.username ? ` · ${row.username}` : row.employeeName ? ` · ${row.employeeName}` : ''}`;
    try {
      if (!row.username && !row.employeeName) throw new Error('员工账号不能为空。');
      if (!row.storeName) throw new Error('门店不能为空。');
      if (!row.overtimeDate) throw new Error('加班日期格式无效，请填写 YYYY-MM-DD。');
      if (row.overtimeDate > input.today) throw new Error('加班日期不能晚于今天。');
      if (!Number.isFinite(row.hours) || row.hours < 0.5 || row.hours > 6 || row.hours * 2 % 1 !== 0) {
        throw new Error('加班工时必须为 0.5–6 小时，并按 0.5 小时递增。');
      }
      const profile = resolveProfile(row, availableProfiles);
      const store = resolveStore(row, input.stores);
      await input.recordOvertime({
        hours: row.hours,
        overtimeDate: row.overtimeDate,
        profileId: profile.id,
        reason: row.reason,
        storeId: store.id,
      });
      succeeded += 1;
    } catch (error) {
      failures.push({ item, reason: error instanceof Error ? error.message : '该行加班工时登记失败。' });
    } finally {
      completed += 1;
      input.onProgress?.(completed, input.rows.length);
    }
  }

  return { failed: failures.length, failures, succeeded, total: input.rows.length };
}

export function createOvertimeImportTemplate(profiles: OvertimeImportProfile[], stores: OvertimeImportStore[]) {
  const workbook = XLSX.utils.book_new();
  const inputSheet = XLSX.utils.aoa_to_sheet([
    ['员工账号', '员工姓名', '门店', '加班日期', '加班工时', '登记说明'],
  ]);
  inputSheet['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(workbook, inputSheet, '加班工时导入');

  const referenceRows = profiles
    .filter((profile) => profile.is_active && profile.employment_type === 'full_time' && (profile.role === 'staff' || profile.role === 'manager'))
    .map((profile) => ({ 员工账号: profile.username, 员工姓名: profile.display_name, 身份: profile.role === 'manager' ? '店长' : '员工' }));
  const referenceSheet = XLSX.utils.json_to_sheet(referenceRows, { header: ['员工账号', '员工姓名', '身份'] });
  referenceSheet['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, referenceSheet, '员工参考');

  const storeSheet = XLSX.utils.json_to_sheet(stores.map((store) => ({ 门店完整名称: store.name, 门店简称: store.short_name ?? '' })), { header: ['门店完整名称', '门店简称'] });
  storeSheet['!cols'] = [{ wch: 28 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, storeSheet, '门店参考');

  const instructionSheet = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    ['1. 员工账号、门店、加班日期、加班工时为必填项；员工姓名用于校验，可不填。'],
    ['2. 日期使用 YYYY-MM-DD；工时范围为 0.5–6 小时，按 0.5 小时递增。'],
    ['3. 同一员工、门店和日期已有记录时，导入会更新原记录并直接确认通过。'],
    ['4. 单行错误不会中断整批，导入完成后系统会逐条报告失败原因。'],
  ]);
  instructionSheet['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, '填写说明');

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadOvertimeImportTemplate(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '员工加班工时批量导入模板.xlsx';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
