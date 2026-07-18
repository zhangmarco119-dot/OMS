import { X } from 'lucide-react';

import { fieldTypeLabel, type TaskTemplateFieldType } from '../task-templates/templateForm';
import type { TaskContentDraft } from './taskContent';

export function TaskContentEditor({ busy, draft, dueAt, onCancel, onChange, onDueAtChange, onSave, title = '编辑任务内容' }: {
  busy: boolean;
  draft: TaskContentDraft;
  dueAt?: string;
  onCancel: () => void;
  onChange: (draft: TaskContentDraft) => void;
  onDueAtChange?: (value: string) => void;
  onSave: () => void;
  title?: string;
}) {
  const updateGroup = (groupIndex: number, fields: Partial<TaskContentDraft['groups'][number]>) => onChange({
    ...draft,
    groups: draft.groups.map((group, index) => index === groupIndex ? { ...group, ...fields } : group),
  });
  const updateItem = (groupIndex: number, itemIndex: number, fields: Partial<TaskContentDraft['groups'][number]['items'][number]>) => {
    const group = draft.groups[groupIndex];
    updateGroup(groupIndex, { items: group.items.map((item, index) => index === itemIndex ? { ...item, ...fields } : item) });
  };

  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-black/45 p-3" role="dialog" aria-modal="true" aria-label={title}>
    <section className="mx-auto max-w-2xl rounded-xl bg-canvas p-3 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center justify-between rounded-xl bg-white p-3 shadow-sm"><div><p className="text-xs font-bold text-brand-700">任务发布后修改</p><h2 className="text-lg font-bold">{title}</h2></div><button aria-label="关闭任务内容编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button></header>
      <p className="mt-3 rounded-lg bg-brand-50 p-3 text-xs leading-5 text-brand-800">修改会同步到员工当前任务；项目编号、字段类型和员工已填写内容会保留，避免数据丢失。</p>
      <label className="mt-3 block text-sm font-semibold">任务名称<input className="ui-input mt-1" onChange={(event) => onChange({ ...draft, name: event.target.value })} value={draft.name} /></label>
      {dueAt !== undefined && onDueAtChange ? <label className="mt-3 block text-sm font-semibold">验收截止时间<input className="ui-input mt-1" onChange={(event) => onDueAtChange(event.target.value)} type="datetime-local" value={dueAt} /></label> : null}
      <div className="mt-3 space-y-3">{draft.groups.map((group, groupIndex) => <section className="ui-card p-3" key={group.id}><div className="grid gap-2 sm:grid-cols-2"><label className="text-sm font-semibold">分组 {groupIndex + 1} 名称<input className="ui-input mt-1" onChange={(event) => updateGroup(groupIndex, { title: event.target.value })} value={group.title} /></label><label className="text-sm font-semibold">分组说明<input className="ui-input mt-1" onChange={(event) => updateGroup(groupIndex, { description: event.target.value })} value={group.description} /></label></div><div className="mt-3 space-y-2">{group.items.map((item, itemIndex) => <article className="rounded-lg border border-slate-200 p-3" key={item.id}><div className="flex items-center justify-between gap-2"><b className="text-sm">项目 {groupIndex + 1}.{itemIndex + 1}</b><span className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{fieldTypeLabel[item.fieldType as TaskTemplateFieldType] ?? item.fieldType}</span></div><label className="mt-2 block text-sm font-semibold">项目名称<input className="ui-input mt-1" onChange={(event) => updateItem(groupIndex, itemIndex, { label: event.target.value })} value={item.label} /></label><label className="mt-2 block text-sm font-semibold">标准说明<textarea className="ui-input mt-1 min-h-16 py-2" onChange={(event) => updateItem(groupIndex, itemIndex, { guidance: event.target.value })} value={item.guidance} /></label></article>)}</div></section>)}</div>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5"><div className="mx-auto grid max-w-2xl grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={onCancel} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={onSave} type="button">{busy ? '正在保存' : '保存并同步'}</button></div></div>
    </section>
  </div>;
}
