import * as XLSX from 'xlsx';
import { ProductItem, ItemStatus, User } from '../types';

// --- MOCK DATA FOR DEMONSTRATION ---
export const MOCK_USERS: User[] = [
  { username: 'wdk_user', password: '123', storeName: '宝珠奶酪（五道口店）' },
  { username: 'xzm_user', password: '123', storeName: 'OMEGA酸奶（西直门店）' },
];

const MOCK_PRODUCTS_WDK = [
  { name: '原味奶酪', spec: '200g/碗', unit: '碗' },
  { name: '草莓果酱', spec: '5kg/桶', unit: '桶' },
  { name: '一次性勺子', spec: '100支/包', unit: '包' },
  { name: '打包袋', spec: '50个/捆', unit: '捆' },
  { name: '全脂牛奶', spec: '1L/盒', unit: '盒' },
];

const MOCK_PRODUCTS_XZM = [
  { name: '希腊酸奶', spec: '150g/杯', unit: '杯' },
  { name: '蓝莓', spec: '125g/盒', unit: '盒' },
  { name: '格兰诺拉麦片', spec: '1kg/袋', unit: '袋' },
  { name: '蜂蜜', spec: '500g/瓶', unit: '瓶' },
];

// --- PUBLIC METHODS ---

export const fetchUsers = async (): Promise<User[]> => {
  try {
    const response = await fetch('/config/users.json');
    if (!response.ok) throw new Error("Config not found");
    const users = await response.json();
    return users;
  } catch (error) {
    console.warn("Failed to fetch users.json, using mock data.", error);
    return MOCK_USERS;
  }
};

export const fetchProducts = async (storeName: string): Promise<ProductItem[]> => {
  try {
    const response = await fetch('/config/products.xlsx');
    if (!response.ok) throw new Error("Excel not found");
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    if (!workbook.SheetNames.includes(storeName)) {
      throw new Error(`Sheet "${storeName}" not found in Excel.`);
    }

    const worksheet = workbook.Sheets[storeName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

    return mapExcelDataToItems(jsonData);

  } catch (error) {
    console.warn(`Failed to fetch products for ${storeName}, using mock data.`, error);
    const mockSource = storeName.includes('五道口') ? MOCK_PRODUCTS_WDK : MOCK_PRODUCTS_XZM;
    return mapExcelDataToItems(mockSource);
  }
};

export const exportToExcel = (items: ProductItem[], user: User, mode: string) => {
  const typeStr = mode === 'COUNT' ? '盘点' : '订货';
  const dateStr = new Date().toLocaleString();
  const fileNameDatePart = new Date().toISOString().slice(0, 10);
  
  // 1. Prepare Metadata Rows
  const metadata = [
    ["门店名称", user.storeName],
    ["操作人员", user.username],
    ["单据类型", typeStr],
    ["操作时间", dateStr],
    [] // Empty row spacer
  ];

  // 2. Prepare Data Rows
  const tableData = items.map((item, index) => {
    const statusText = item.status === ItemStatus.SKIPPED ? '无需订货' : (item.quantity?.toString() || '0');
    
    let notes = [];
    if (item.isNew) notes.push('新增');
    if (item.isUnused) notes.push('不再使用');
    if (item.hasError) notes.push('信息有误(已修正)');

    return {
      '序号': index + 1,
      '货品名称': item.name,
      '规格': item.spec,
      '单位': item.unit,
      [mode === 'COUNT' ? '盘点数量' : '订货数量']: statusText,
      '备注': notes.join(', '),
      '原始名称': item.originalName || '',
      '原始规格': item.originalSpec || '',
    };
  });

  // 3. Create Sheet with Metadata
  // Use aoa_to_sheet for the first part
  const ws = XLSX.utils.aoa_to_sheet(metadata);

  // 4. Append Table Data starting from row 6 (index 5, since metadata uses 0-4)
  XLSX.utils.sheet_add_json(ws, tableData, { origin: "A6" });

  // 5. Create Workbook and Download
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "清单");
  
  const fileName = `${user.storeName}_${typeStr}单_${user.username}_${fileNameDatePart}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

// --- HELPER ---
const mapExcelDataToItems = (data: any[]): ProductItem[] => {
  return data.map((row, index) => ({
    id: `item-${index}-${Date.now()}`,
    name: row['货品名称'] || row['name'] || '未知商品',
    spec: row['规格'] || row['spec'] || '',
    unit: row['点货单位'] || row['单位'] || row['unit'] || '个',
    quantity: null,
    status: ItemStatus.PENDING,
    isUnused: false,
    hasError: false,
    isNew: false
  }));
};