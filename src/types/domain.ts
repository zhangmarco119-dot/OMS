export type StoreId = string;

export type UserRole = 'staff' | 'manager' | 'admin';

export type TaskType = 'inventory' | 'order';

export type TaskStatus = 'draft' | 'review' | 'submitted' | 'cancelled';

export type TaskItemStatus = 'pending' | 'completed' | 'no_order_needed';

export type ProductFeedbackType = 'discontinued' | 'incorrect' | 'new';

export interface Store {
  id: StoreId;
  name: string;
  shortName: string;
}

export interface RoutePlanItem {
  path: string;
  phase: number;
  purpose: string;
}
