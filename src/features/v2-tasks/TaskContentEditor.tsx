import { Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { TaskTemplateReferenceImageUpload } from '../task-templates/TaskTemplateReferenceImageUpload';
import { fieldTypeLabel, taskTemplateFieldTypes } from '../task-templates/templateForm';
import {
  createEmptyTaskContentGroup,
  createEmptyTaskContentItem,
  type TaskContentDraft,
  type TaskContentItemDraft,
} from './taskContent';

export function TaskContentEditor({
  busy,
  categories,
  draft,
  dueAt,
  onCancel,
  onChange,
  onDueAtChange,
  onRemoveReferenceImage,
  onSave,
  onUploadReferenceImage,
  managerReviewEnabled,
  onManagerReviewEnabledChange,
  advancedOptions,
  title = '编辑已发布任务',
}: {
  busy: boolean;
  categories: Array<{ code: string; label: string }>;
  draft: TaskContentDraft;
  dueAt?: string;
  onCancel: () => void;
  onChange: (draft: TaskContentDraft) => void;
  onDueAtChange?: (value: string) => void;
  onRemoveReferenceImage: (itemId: string, path: string) => void;
  onSave: () => void;
  onUploadReferenceImage: (itemId: string, file: File, onProgress: (progress: number) => void) => Promise<void>;
  managerReviewEnabled?: boolean;
  onManagerReviewEnabledChange?: (enabled: boolean) => void;
  advancedOptions?: ReactNode;
  title?: string;
}) {
  const updateGroup = (groupIndex: number, fields: Partial<TaskContentDraft['groups'][number]>) => onChange({
    ...draft,
    groups: draft.groups.map((group, index) => index === groupIndex ? { ...group, ...fields } : group),
  });
  const updateItem = (groupIndex: number, itemIndex: number, fields: Partial<TaskContentItemDraft>) => {
    const group = draft.groups[groupIndex];
    updateGroup(groupIndex, { items: group.items.map((item, index) => index === itemIndex ? { ...item, ...fields } : item) });
  };

  return <div className="fixed inset-0 z-50 h-[100dvh] overflow-y-auto overscroll-contain bg-canvas px-3 pt-3 sm:px-5 sm:pt-5" role="dialog" aria-modal="true" aria-label={title}>
    <div className="mx-auto max-w-3xl space-y-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between p-3.5"><div><p className="text-xs font-bold text-brand-700">任务修改后立即同步给员工</p><h2 className="text-xl font-bold">{title}</h2></div><button aria-label="关闭任务编辑" className="ui-icon-button" onClick={onCancel} type="button"><X className="h-5 w-5" /></button></header>
      <p className="rounded-lg bg-brand-50 p-3 text-xs leading-5 text-brand-800">这里可以像编辑模板一样修改完整任务内容。新增项目会立即加入员工当前任务；已有填写内容的项目不能直接删除或改变字段类型，以避免员工数据丢失。</p>
      <section className="ui-card grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">任务名称<input className="ui-input mt-1" onChange={(event) => onChange({ ...draft, name: event.target.value })} value={draft.name} /></label>
        <label className="text-sm font-semibold">分类<select className="ui-input mt-1" onChange={(event) => onChange({ ...draft, category: event.target.value })} value={draft.category}>{categories.map((category) => <option key={category.code} value={category.code}>{category.label}</option>)}</select></label>
        <label className="text-sm font-semibold sm:col-span-2">任务说明<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => onChange({ ...draft, description: event.target.value })} value={draft.description} /></label>
        {dueAt !== undefined && onDueAtChange ? <label className="text-sm font-semibold sm:col-span-2">验收截止时间<input className="ui-input mt-1" onChange={(event) => onDueAtChange(event.target.value)} type="datetime-local" value={dueAt} /></label> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.requiresReview} onChange={(event) => onChange({ ...draft, requiresReview: event.target.checked })} type="checkbox" />需要管理员审核</label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input checked={draft.allowOverdue} onChange={(event) => onChange({ ...draft, allowOverdue: event.target.checked })} type="checkbox" />允许逾期补交</label>
        {managerReviewEnabled !== undefined && onManagerReviewEnabledChange ? <label className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm sm:col-span-2"><input checked={managerReviewEnabled} className="mt-1" onChange={(event) => onManagerReviewEnabledChange(event.target.checked)} type="checkbox" /><span><b className="block text-brand-900">允许店长审核员工提交</b><span className="mt-1 block text-xs leading-5 text-brand-800">管理员始终可以审核；店长只能审核本门店员工提交的任务，店长本人提交仍必须由管理员审核。</span></span></label> : null}
        {advancedOptions ? <div className="sm:col-span-2">{advancedOptions}</div> : null}
      </section>
      {draft.groups.map((group, groupIndex) => <section className="ui-card p-4" key={group.id}>
        <div className="mb-3 flex items-center justify-between gap-2"><span className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">分组 {groupIndex + 1}</span><button aria-label={`删除分组 ${groupIndex + 1}`} className="ui-icon-button border-red-100 text-red-600" onClick={() => onChange({ ...draft, groups: draft.groups.filter((_, index) => index !== groupIndex) })} type="button"><Trash2 className="h-4 w-4" /></button></div>
        <div className="grid gap-2 sm:grid-cols-2"><label className="text-sm font-semibold">分组名称<input className="ui-input mt-1" onChange={(event) => updateGroup(groupIndex, { title: event.target.value })} value={group.title} /></label><label className="text-sm font-semibold">分组说明<input className="ui-input mt-1" onChange={(event) => updateGroup(groupIndex, { description: event.target.value })} value={group.description} /></label></div>
        <div className="mt-3 space-y-3">{group.items.map((item, itemIndex) => <TaskItemEditor busy={busy} item={item} itemNumber={`${groupIndex + 1}.${itemIndex + 1}`} key={item.id} onChange={(fields) => updateItem(groupIndex, itemIndex, fields)} onRemove={() => updateGroup(groupIndex, { items: group.items.filter((_, index) => index !== itemIndex) })} onRemoveReferenceImage={onRemoveReferenceImage} onUploadReferenceImage={onUploadReferenceImage} />)}</div>
        <button className="ui-button-secondary mt-3 px-3" onClick={() => updateGroup(groupIndex, { items: [...group.items, createEmptyTaskContentItem()] })} type="button"><Plus className="h-4 w-4" />添加项目</button>
      </section>)}
      <button className="ui-button-secondary" onClick={() => onChange({ ...draft, groups: [...draft.groups, createEmptyTaskContentGroup()] })} type="button"><Plus className="h-4 w-4" />添加分组</button>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"><div className="mx-auto grid max-w-3xl grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={onCancel} type="button">取消</button><button className="ui-button-primary" disabled={busy} onClick={onSave} type="button">{busy ? '正在保存' : '保存并同步'}</button></div></div>
    </div>
  </div>;
}

function TaskItemEditor({ busy, item, itemNumber, onChange, onRemove, onRemoveReferenceImage, onUploadReferenceImage }: {
  busy: boolean;
  item: TaskContentItemDraft;
  itemNumber: string;
  onChange: (fields: Partial<TaskContentItemDraft>) => void;
  onRemove: () => void;
  onRemoveReferenceImage: (itemId: string, path: string) => void;
  onUploadReferenceImage: (itemId: string, file: File, onProgress: (progress: number) => void) => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  return <article className="rounded-lg border border-slate-200 p-3">
    <div className="flex items-center justify-between gap-2"><span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-bold text-white">项目 {itemNumber}</span><button aria-label={`删除项目 ${itemNumber}`} className="ui-icon-button h-10 w-10 border-red-100 text-red-600" onClick={onRemove} type="button"><Trash2 className="h-4 w-4" /></button></div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <label className="text-sm font-semibold">项目名称<input className="ui-input mt-1" onChange={(event) => onChange({ label: event.target.value })} value={item.label} /></label>
      <label className="text-sm font-semibold">字段类型<select className="ui-input mt-1" onChange={(event) => onChange({ fieldType: event.target.value as TaskContentItemDraft['fieldType'] })} value={item.fieldType}>{taskTemplateFieldTypes.map((type) => <option key={type} value={type}>{fieldTypeLabel[type]}</option>)}</select></label>
      <label className="text-sm font-semibold sm:col-span-2">标准说明<textarea className="ui-input mt-1 min-h-16 py-2" onChange={(event) => onChange({ guidance: event.target.value })} value={item.guidance} /></label>
      {['single_choice', 'multi_choice'].includes(item.fieldType) ? <label className="text-sm font-semibold sm:col-span-2">选项（每行一个）<textarea className="ui-input mt-1 min-h-20 py-2" onChange={(event) => onChange({ optionsText: event.target.value })} value={item.optionsText} /></label> : null}
      <label className="text-sm font-semibold">图片要求<select className="ui-input mt-1" onChange={(event) => onChange({ imageRequirement: event.target.value as TaskContentItemDraft['imageRequirement'] })} value={item.imageRequirement}><option value="none">不要求</option><option value="single">至少一张</option><option value="multiple">多张图片</option></select></label>
      {item.imageRequirement === 'multiple' ? <label className="text-sm font-semibold">至少上传张数<input className="ui-input mt-1" max={20} min={2} onChange={(event) => onChange({ minimumImageCount: Math.max(2, Math.min(20, Number(event.target.value) || 2)) })} type="number" value={item.minimumImageCount} /><span className="mt-1 block text-xs font-normal text-slate-500">员工少于此数量时无法提交。</span></label> : null}
      <label className="flex min-h-11 items-center gap-2 self-end text-sm font-semibold"><input checked={item.isRequired} onChange={(event) => onChange({ isRequired: event.target.checked })} type="checkbox" />必填</label>
      <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">参考图片（选填）</b><p className="mt-1 text-xs text-slate-500">上传后立即预览；保存任务后员工端同步显示。</p></div><TaskTemplateReferenceImageUpload disabled={busy} onUpload={(file, onProgress) => onUploadReferenceImage(item.id, file, onProgress)} /></div>
        {item.referenceImageUrls.length ? <div className="mt-3 flex flex-wrap gap-2">{item.referenceImageUrls.map((url, index) => <div className="relative" key={item.referenceImagePaths[index] ?? url}><button className="block overflow-hidden rounded-lg border" onClick={() => setPreview(url)} type="button"><img alt={`参考图片 ${index + 1}`} className="h-16 w-16 object-cover" src={url} /></button><button aria-label={`删除参考图片 ${index + 1}`} className="absolute -right-2 -top-2 h-6 min-h-0 w-6 rounded-full bg-red-600 text-xs font-bold text-white" onClick={() => { const path = item.referenceImagePaths[index]; if (path) onRemoveReferenceImage(item.id, path); }} type="button">×</button></div>)}</div> : null}
      </div>
    </div>
    {preview ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4" onClick={() => setPreview(null)} role="dialog" aria-label="参考图片大图预览"><img alt="参考图片大图" className="max-h-full max-w-full object-contain" src={preview} /></div> : null}
  </article>;
}
