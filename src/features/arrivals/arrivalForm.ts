import { z } from 'zod';

import { createUuid } from '../../lib/uuid';

export interface ArrivalDraftItem {
  id: string;
  isUnmatchedProduct: boolean;
  note: string;
  productId: string | null;
  productName: string;
  quantity: string;
  sortOrder: number;
  spec: string;
  unit: string;
}

export interface ArrivalValidationInput {
  goodsImageCount: number;
  items: ArrivalDraftItem[];
  uploadCount: number;
  waybillImageCount: number;
}

export const isProhibitedArrivalUnit = (unit: string) => {
  const normalized = unit.trim();
  return normalized.includes('箱') || normalized.includes('件');
};

const quantitySchema = z.string().trim().refine((value) => {
  const quantity = Number(value);
  return value.length > 0 && Number.isFinite(quantity) && quantity > 0;
}, '数量必须大于 0。').refine((value) => {
  const decimals = value.split('.')[1]?.length ?? 0;
  return decimals <= 3;
}, '数量最多保留 3 位小数。').refine((value) => Number(value) <= 999_999_999.999, {
  message: '数量超出允许范围。',
});

export const arrivalDraftItemSchema = z.object({
  id: z.string().uuid(),
  isUnmatchedProduct: z.boolean(),
  note: z.string(),
  productId: z.string().uuid().nullable(),
  productName: z.string().trim().min(1, '请填写产品名称。'),
  quantity: quantitySchema,
  sortOrder: z.number().int().nonnegative(),
  spec: z.string(),
  unit: z.string().trim().min(1, '请填写单位。'),
}).superRefine((item, context) => {
  if (isProhibitedArrivalUnit(item.unit)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '禁止使用箱、整箱、件或整件作为单位，请按瓶、袋、盒、个、杯、克或毫升等最小单位计数。',
      path: ['unit'],
    });
  }

  if ((item.productId === null) !== item.isUnmatchedProduct) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: '产品匹配状态无效，请重新选择或手动填写。',
      path: ['productId'],
    });
  }
});

export const createEmptyArrivalItem = (sortOrder = 0): ArrivalDraftItem => ({
  id: createUuid(),
  isUnmatchedProduct: true,
  note: '',
  productId: null,
  productName: '',
  quantity: '',
  sortOrder,
  spec: '',
  unit: '',
});

export const isCompleteArrivalItem = (item: ArrivalDraftItem) =>
  arrivalDraftItemSchema.safeParse(item).success;

const formatQuantity = (value: string) => String(Number(value));

export const generateArrivalSummary = (items: ArrivalDraftItem[]) => {
  const completeItems = items.filter(isCompleteArrivalItem);
  if (completeItems.length === 0) {
    return '';
  }

  const descriptions = completeItems.map((item) =>
    `${item.productName.trim()} ${formatQuantity(item.quantity)} ${item.unit.trim()}`,
  );

  return descriptions.length === 1
    ? `${completeItems[0].productName.trim()}到货 ${formatQuantity(completeItems[0].quantity)} ${completeItems[0].unit.trim()}。`
    : `本次到货：${descriptions.join('，')}。`;
};

export const getArrivalValidationIssues = ({
  goodsImageCount,
  items,
  uploadCount,
  waybillImageCount,
}: ArrivalValidationInput) => {
  const issues: string[] = [];

  if (waybillImageCount < 1) {
    issues.push('至少上传一张面单照片。');
  }
  if (goodsImageCount < 1) {
    issues.push('至少上传一张拆包货品照片。');
  }
  if (uploadCount > 0) {
    issues.push(`还有 ${uploadCount} 张图片正在上传。`);
  }
  if (items.length < 1) {
    issues.push('至少添加一个产品。');
  }

  items.forEach((item, index) => {
    const parsed = arrivalDraftItemSchema.safeParse(item);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? '产品信息不完整。';
      issues.push(`产品 ${index + 1}：${firstIssue}`);
    }
  });

  return issues;
};
