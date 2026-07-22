import { createUuid } from '../../lib/uuid';
import type { Json } from '../../types/database';
import {
  taskTemplateFieldTypes,
  type ImageRequirement,
  type TaskTemplateFieldType,
} from '../task-templates/templateForm';

type JsonObject = { [key: string]: Json | undefined };

export interface TaskContentItemDraft {
  fieldType: TaskTemplateFieldType;
  guidance: string;
  id: string;
  imageRequirement: ImageRequirement;
  isRequired: boolean;
  label: string;
  minimumImageCount: number;
  optionsText: string;
  raw: JsonObject;
  referenceImagePaths: string[];
  referenceImageUrls: string[];
}

export interface TaskContentGroupDraft {
  description: string;
  id: string;
  items: TaskContentItemDraft[];
  raw: JsonObject;
  title: string;
}

export interface TaskContentDraft {
  allowOverdue: boolean;
  category: string;
  description: string;
  groups: TaskContentGroupDraft[];
  name: string;
  requiresReview: boolean;
  root: JsonObject;
}

const asObject = (value: Json | undefined): JsonObject => value !== null && !Array.isArray(value) && typeof value === 'object'
  ? value as JsonObject
  : {};
const asString = (value: Json | undefined) => typeof value === 'string' ? value : '';
const asBoolean = (value: Json | undefined, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const asStringArray = (value: Json | undefined) => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];
const asFieldType = (value: Json | undefined): TaskTemplateFieldType => typeof value === 'string' && taskTemplateFieldTypes.includes(value as TaskTemplateFieldType)
  ? value as TaskTemplateFieldType
  : 'confirmation';
const asImageRequirement = (value: Json | undefined): ImageRequirement => value === 'single' || value === 'multiple' ? value : 'none';
const asMinimumImageCount = (value: Json | undefined) => typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 20 ? value : 2;

export const createEmptyTaskContentItem = (): TaskContentItemDraft => ({
  fieldType: 'confirmation',
  guidance: '',
  id: createUuid(),
  imageRequirement: 'none',
  isRequired: true,
  label: '',
  minimumImageCount: 2,
  optionsText: '',
  raw: {},
  referenceImagePaths: [],
  referenceImageUrls: [],
});

export const createEmptyTaskContentGroup = (): TaskContentGroupDraft => ({
  description: '',
  id: createUuid(),
  items: [createEmptyTaskContentItem()],
  raw: {},
  title: '',
});

export const taskContentFromSnapshot = (name: string, snapshot: Json, referenceUrls: Record<string, string[]> = {}): TaskContentDraft => {
  const root = asObject(snapshot);
  const template = asObject(root.template);
  const groups = Array.isArray(root.groups) ? root.groups : [];
  return {
    allowOverdue: asBoolean(template.allow_overdue, false),
    category: asString(template.category),
    description: asString(template.description),
    groups: groups.map((groupValue) => {
      const group = asObject(groupValue);
      const items = Array.isArray(group.items) ? group.items : [];
      return {
        description: asString(group.description),
        id: asString(group.id),
        items: items.map((itemValue) => {
          const item = asObject(itemValue);
          const legacyPath = asString(item.reference_image_path);
          const paths = [...new Set([...asStringArray(item.reference_image_paths), ...(legacyPath ? [legacyPath] : [])])];
          return {
            fieldType: asFieldType(item.field_type),
            guidance: asString(item.guidance),
            id: asString(item.id),
            imageRequirement: asImageRequirement(item.image_requirement),
            isRequired: asBoolean(item.is_required, true),
            label: asString(item.label),
            minimumImageCount: asMinimumImageCount(item.minimum_image_count),
            optionsText: asStringArray(item.options).join('\n'),
            raw: item,
            referenceImagePaths: paths,
            referenceImageUrls: referenceUrls[asString(item.id)] ?? [],
          };
        }),
        raw: group,
        title: asString(group.title),
      };
    }),
    name,
    requiresReview: asBoolean(template.requires_review, true),
    root,
  };
};

export const taskContentToSnapshot = (draft: TaskContentDraft): Json => {
  const template = asObject(draft.root.template);
  return {
    ...draft.root,
    groups: draft.groups.map((group, groupIndex) => ({
      ...group.raw,
      description: group.description,
      id: group.id,
      items: group.items.map((item, itemIndex) => ({
        ...item.raw,
        field_type: item.fieldType,
        guidance: item.guidance,
        id: item.id,
        image_requirement: item.imageRequirement,
        is_required: item.isRequired,
        label: item.label,
        minimum_image_count: item.imageRequirement === 'multiple' ? item.minimumImageCount : null,
        options: item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean),
        reference_image_path: item.referenceImagePaths[0] ?? null,
        reference_image_paths: item.referenceImagePaths,
        sort_order: itemIndex,
      })),
      sort_order: groupIndex,
      title: group.title,
    })),
    template: {
      ...template,
      allow_overdue: draft.allowOverdue,
      category: draft.category,
      description: draft.description,
      name: draft.name.trim(),
      requires_review: draft.requiresReview,
    },
  } as Json;
};

export const taskContentReferencePaths = (draft: TaskContentDraft) => [...new Set(draft.groups.flatMap((group) => group.items.flatMap((item) => item.referenceImagePaths)))];

export const validateTaskContent = (draft: TaskContentDraft) => {
  if (!draft.name.trim()) return '请填写任务名称。';
  if (!draft.category.trim()) return '请选择任务分类。';
  if (!draft.groups.length) return '任务至少需要一个分组。';
  for (const group of draft.groups) {
    if (!group.id || !group.title.trim()) return '每个分组都需要填写名称。';
    if (!group.items.length) return `分组“${group.title}”至少需要一个项目。`;
    for (const item of group.items) {
      if (!item.id || !item.label.trim()) return `分组“${group.title}”中的每个项目都需要填写名称。`;
      if (item.imageRequirement === 'multiple' && (!Number.isInteger(item.minimumImageCount) || item.minimumImageCount < 2 || item.minimumImageCount > 20)) return `项目“${item.label}”需要设置 2 至 20 张的最低图片数量。`;
      if (['single_choice', 'multi_choice'].includes(item.fieldType) && !item.optionsText.split('\n').some((option) => option.trim())) return `项目“${item.label}”至少需要一个选项。`;
    }
  }
  return null;
};
