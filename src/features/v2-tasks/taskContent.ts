import type { Json } from '../../types/database';

type JsonObject = { [key: string]: Json | undefined };

export interface TaskContentItemDraft {
  fieldType: string;
  guidance: string;
  id: string;
  label: string;
  raw: JsonObject;
}

export interface TaskContentGroupDraft {
  description: string;
  id: string;
  items: TaskContentItemDraft[];
  raw: JsonObject;
  title: string;
}

export interface TaskContentDraft {
  groups: TaskContentGroupDraft[];
  name: string;
  root: JsonObject;
}

const asObject = (value: Json | undefined): JsonObject => value !== null && !Array.isArray(value) && typeof value === 'object'
  ? value as JsonObject
  : {};

const asString = (value: Json | undefined) => typeof value === 'string' ? value : '';

export const taskContentFromSnapshot = (name: string, snapshot: Json): TaskContentDraft => {
  const root = asObject(snapshot);
  const groups = Array.isArray(root.groups) ? root.groups : [];
  return {
    groups: groups.map((groupValue) => {
      const group = asObject(groupValue);
      const items = Array.isArray(group.items) ? group.items : [];
      return {
        description: asString(group.description),
        id: asString(group.id),
        items: items.map((itemValue) => {
          const item = asObject(itemValue);
          return {
            fieldType: asString(item.field_type),
            guidance: asString(item.guidance),
            id: asString(item.id),
            label: asString(item.label),
            raw: item,
          };
        }),
        raw: group,
        title: asString(group.title),
      };
    }),
    name,
    root,
  };
};

export const taskContentToSnapshot = (draft: TaskContentDraft): Json => {
  const template = asObject(draft.root.template);
  return {
    ...draft.root,
    groups: draft.groups.map((group) => ({
      ...group.raw,
      description: group.description,
      items: group.items.map((item) => ({
        ...item.raw,
        guidance: item.guidance,
        label: item.label,
      })),
      title: group.title,
    })),
    template: { ...template, name: draft.name.trim() },
  } as Json;
};

export const validateTaskContent = (draft: TaskContentDraft) => {
  if (!draft.name.trim()) return '请填写任务名称。';
  if (!draft.groups.length) return '任务至少需要一个分组。';
  for (const group of draft.groups) {
    if (!group.id || !group.title.trim()) return '每个分组都需要填写名称。';
    if (!group.items.length) return `分组“${group.title}”至少需要一个项目。`;
    if (group.items.some((item) => !item.id || !item.label.trim())) return `分组“${group.title}”中的每个项目都需要填写名称。`;
  }
  return null;
};
