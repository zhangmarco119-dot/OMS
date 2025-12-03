import * as XLSX from 'xlsx';
import { ProductItem, ItemStatus, User } from '../types';

// --- MOCK DATA FOR DEMONSTRATION IF FILES MISSING ---
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
    
    // Check if sheet exists
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

export const exportToExcel = (items: ProductItem[], user: User, mode: string, startTime: number) => {
  const headers = items.map((item, index) => {
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

  const ws = XLSX.utils.json_to_sheet(headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "清单");

  // Generate filename
  const dateStr = new Date().toISOString().slice(0, 10);
  const typeStr = mode === 'COUNT' ? '盘点单' : '订货单';
  const fileName = `${user.storeName}_${typeStr}_${user.username}_${dateStr}.xlsx`;

  XLSX.writeFile(wb, fileName);
};

// --- TEMPLATE GENERATION ---

export const downloadTemplates = () => {
  // 1. Generate users.json
  const usersTemplate = [
    { "username": "店员A", "password": "123", "storeName": "宝珠奶酪（五道口店）" },
    { "username": "店员B", "password": "123", "storeName": "OMEGA酸奶（西直门店）" }
  ];
  const blob = new Blob([JSON.stringify(usersTemplate, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "users.json";
  a.click();
  URL.revokeObjectURL(url);

  // 2. Generate products.xlsx
  const wb = XLSX.utils.book_new();
  
  // Sheet 1
  const data1 = [
    { "货品名称": "示例货品1", "规格": "500g/袋", "点货单位": "袋" },
    { "货品名称": "示例货品2", "规格": "10个/盒", "点货单位": "盒" }
  ];
  const ws1 = XLSX.utils.json_to_sheet(data1);
  XLSX.utils.book_append_sheet(wb, ws1, "宝珠奶酪（五道口店）");

  // Sheet 2
  const data2 = [
    { "货品名称": "酸奶A", "规格": "1杯", "点货单位": "杯" },
    { "货品名称": "配料B", "规格": "1kg/桶", "点货单位": "桶" }
  ];
  const ws2 = XLSX.utils.json_to_sheet(data2);
  XLSX.utils.book_append_sheet(wb, ws2, "OMEGA酸奶（西直门店）");

  XLSX.writeFile(wb, "products.xlsx");
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