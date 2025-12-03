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

const generateWorkbook = (items: ProductItem[], user: User, mode: string) => {
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
  return wb;
};

// Legacy download method (fallback)
export const exportToExcel = (items: ProductItem[], user: User, mode: string, startTime: number) => {
  const wb = generateWorkbook(items, user, mode);
  const dateStr = new Date().toISOString().slice(0, 10);
  const typeStr = mode === 'COUNT' ? '盘点单' : '订货单';
  const fileName = `${user.storeName}_${typeStr}_${user.username}_${dateStr}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

// New Sharing Method
export const shareExcel = async (items: ProductItem[], user: User, mode: string) => {
  const wb = generateWorkbook(items, user, mode);
  const dateStr = new Date().toISOString().slice(0, 10);
  const typeStr = mode === 'COUNT' ? '盘点单' : '订货单';
  const fileName = `${user.storeName}_${typeStr}_${user.username}_${dateStr}.xlsx`;

  // Write to binary
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  
  // Create File object
  const file = new File([wbout], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // Check if Web Share API is supported and can share files
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: fileName,
        text: `这是 ${user.storeName} 的${typeStr}，请查收。`,
      });
      return true; // Shared successfully
    } catch (error) {
      console.warn('Sharing failed or canceled', error);
      // If user canceled, we don't necessarily need to download, 
      // but if it failed technically, we might want to fallback.
      // For now, let's treat cancel as "done".
      return false;
    }
  } else {
    // Fallback to direct download
    XLSX.writeFile(wb, fileName);
    return false; // Used fallback
  }
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
