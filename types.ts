export type SystemMode = 'COUNT' | 'ORDER'; // 盘点 | 订货

export enum ItemStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED', // For ordering mode "No Order Needed"
}

export interface User {
  username: string;
  storeName: string; // Must match the Sheet Name in Excel
  password?: string;
}

export interface ProductItem {
  id: string; // Generated or read from Excel
  name: string;
  spec: string;
  unit: string;
  
  // State for the session
  quantity: number | null; // The input value
  status: ItemStatus;
  
  // Flags
  isUnused: boolean; // "不再使用"
  hasError: boolean; // "信息有误"
  isNew: boolean;    // "新增货品"
  
  // If edited due to error
  originalName?: string;
  originalSpec?: string;
  originalUnit?: string;
}

export interface SessionState {
  user: User | null;
  mode: SystemMode | null; // Set when entering a subsystem
  items: ProductItem[];
  startTime: number;
}
