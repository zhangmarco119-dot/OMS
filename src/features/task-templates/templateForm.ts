import { z } from 'zod';

import { createUuid } from '../../lib/uuid';

export const taskTemplateCategories = ['weekly_clean', 'monthly_clean', 'inspection', 'temporary'] as const;
export const taskTemplateFieldTypes = [
  'instruction', 'short_text', 'long_text', 'integer', 'decimal', 'boolean',
  'single_choice', 'multi_choice', 'image', 'multi_image', 'confirmation', 'rating',
] as const;

export type TaskTemplateCategory = typeof taskTemplateCategories[number];
export type TaskTemplateFieldType = typeof taskTemplateFieldTypes[number];
export type ImageRequirement = 'none' | 'single' | 'multiple';

export interface TaskTemplateItemDraft {
  fieldType: TaskTemplateFieldType;
  guidance: string;
  id: string;
  imageRequirement: ImageRequirement;
  isRequired: boolean;
  label: string;
  optionsText: string;
  referenceImagePath: string | null;
  referenceImageUrl: string | null;
  referenceImagePaths: string[];
  referenceImageUrls: string[];
}

export interface TaskTemplateGroupDraft {
  description: string;
  id: string;
  items: TaskTemplateItemDraft[];
  title: string;
}

export interface TaskTemplateDraft {
  allowOverdue: boolean;
  category: TaskTemplateCategory;
  description: string;
  dueTime: string;
  groups: TaskTemplateGroupDraft[];
  id: string | null;
  name: string;
  recurrence: 'none' | 'weekly' | 'monthly';
  recurrenceDay: number | null;
  requiresReview: boolean;
  storeIds: string[];
}

export const createEmptyTemplateItem = (): TaskTemplateItemDraft => ({
  fieldType: 'confirmation',
  guidance: '',
  id: createUuid(),
  imageRequirement: 'none',
  isRequired: true,
  label: '',
  optionsText: '',
  referenceImagePath: null,
  referenceImageUrl: null,
  referenceImagePaths: [],
  referenceImageUrls: [],
});

export const createEmptyTemplateGroup = (): TaskTemplateGroupDraft => ({
  description: '',
  id: createUuid(),
  items: [createEmptyTemplateItem()],
  title: '',
});

export const createEmptyTaskTemplate = (storeIds: string[] = []): TaskTemplateDraft => ({
  allowOverdue: false,
  category: 'weekly_clean',
  description: '',
  dueTime: '20:00',
  groups: [createEmptyTemplateGroup()],
  id: null,
  name: '',
  recurrence: 'weekly',
  recurrenceDay: 1,
  requiresReview: true,
  storeIds,
});

const itemSchema = z.object({
  fieldType: z.enum(taskTemplateFieldTypes),
  guidance: z.string(),
  id: z.string().uuid(),
  imageRequirement: z.enum(['none', 'single', 'multiple']),
  isRequired: z.boolean(),
  label: z.string().trim().min(1, '每个项目都需要填写名称。'),
  optionsText: z.string(),
  referenceImagePath: z.string().nullable(),
  referenceImageUrl: z.string().nullable(),
  referenceImagePaths: z.array(z.string()),
  referenceImageUrls: z.array(z.string()),
}).superRefine((item, context) => {
  if (['single_choice', 'multi_choice'].includes(item.fieldType)
    && item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean).length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '选择题至少需要一个选项。', path: ['optionsText'] });
  }
});

export const taskTemplateDraftSchema = z.object({
  allowOverdue: z.boolean(),
  category: z.enum(taskTemplateCategories),
  description: z.string(),
  dueTime: z.string(),
  groups: z.array(z.object({
    description: z.string(),
    id: z.string().uuid(),
    items: z.array(itemSchema).min(1, '每个分组至少需要一个项目。'),
    title: z.string().trim().min(1, '每个分组都需要填写名称。'),
  })).min(1, '至少需要一个任务分组。'),
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, '请填写模板名称。'),
  recurrence: z.enum(['none', 'weekly', 'monthly']),
  recurrenceDay: z.number().int().min(1).max(31).nullable(),
  requiresReview: z.boolean(),
  storeIds: z.array(z.string().uuid()).min(1, '至少选择一个适用门店。'),
}).superRefine((draft, context) => {
  if (draft.recurrence !== 'none' && !draft.dueTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '周期任务需要设置完成时间。', path: ['dueTime'] });
  }
  if (draft.recurrence === 'weekly' && (draft.recurrenceDay === null || draft.recurrenceDay > 7)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '每周任务需要选择截止日。', path: ['recurrenceDay'] });
  }
  if (draft.recurrence === 'monthly' && draft.recurrenceDay === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '每月任务需要选择截止日。', path: ['recurrenceDay'] });
  }
  if (draft.recurrence === 'none' && draft.recurrenceDay !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '不重复任务不需要周期截止日。', path: ['recurrenceDay'] });
  }
});

export const validateTaskTemplateDraft = (draft: TaskTemplateDraft) => {
  const result = taskTemplateDraftSchema.safeParse(draft);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? '模板内容不完整。');
  return result.data;
};

export const categoryLabel: Record<TaskTemplateCategory, string> = {
  inspection: '巡店',
  monthly_clean: '月清',
  temporary: '临时任务',
  weekly_clean: '周清',
};

export const fieldTypeLabel: Record<TaskTemplateFieldType, string> = {
  boolean: '是/否', confirmation: '确认勾选', decimal: '小数', image: '图片',
  instruction: '说明', integer: '整数', long_text: '长文本', multi_choice: '多选',
  multi_image: '多图片', rating: '评分', short_text: '短文本', single_choice: '单选',
};
