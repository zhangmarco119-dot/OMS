import { BookOpenCheck, Camera, ChevronRight, ClipboardList, Megaphone, Save, Send, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { MobileActionBar } from '../../components/ui/Actions';
import { FeedbackBanner } from '../../components/ui/Feedback';
import type { TaskTemplateDraft, TaskTemplateItemDraft } from '../task-templates/templateForm';
import { productCategoryLabel, type ProductCategoryCode } from '../products/productCategories';
import { TaskReferenceImagePreview } from './TaskReferenceImagePreview';

type RelatedPreview = { title: string; type: 'notice' | 'sop' } | null;

const requiredImageCount = (item: TaskTemplateItemDraft) => item.imageRequirement === 'multiple'
  ? Math.max(2, Math.min(20, item.minimumImageCount))
  : 1;

function PreviewField({ item }: { item: TaskTemplateItemDraft }) {
  const [value, setValue] = useState<string | number | boolean | string[]>('');
  const options = item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean);
  const expectsImages = ['image', 'multi_image'].includes(item.fieldType) || item.imageRequirement !== 'none';
  return <div className="mt-3">
    {item.fieldType === 'instruction' ? <p className="rounded bg-slate-50 p-3 text-sm">请按说明完成本项。</p> : null}
    {['short_text', 'long_text'].includes(item.fieldType) ? <textarea className="ui-input min-h-20 py-3" onChange={(event) => setValue(event.target.value)} value={typeof value === 'string' ? value : ''} /> : null}
    {['integer', 'decimal', 'rating'].includes(item.fieldType) ? <input className="ui-input" onChange={(event) => setValue(event.target.value === '' ? '' : Number(event.target.value))} type="number" value={typeof value === 'number' ? value : ''} /> : null}
    {['boolean', 'confirmation'].includes(item.fieldType) ? <label className="flex min-h-12 items-center gap-3"><input checked={value === true} onChange={(event) => setValue(event.target.checked)} type="checkbox" />确认完成</label> : null}
    {item.fieldType === 'single_choice' ? <select className="ui-input" onChange={(event) => setValue(event.target.value)} value={typeof value === 'string' ? value : ''}><option value="">请选择</option>{options.map((option) => <option key={option}>{option}</option>)}</select> : null}
    {item.fieldType === 'multi_choice' ? <div>{options.map((option) => { const selected = Array.isArray(value) ? value : []; return <label className="mr-4 inline-flex gap-2" key={option}><input checked={selected.includes(option)} onChange={(event) => setValue(event.target.checked ? [...selected, option] : selected.filter((entry) => entry !== option))} type="checkbox" />{option}</label>; })}</div> : null}
    {expectsImages ? <div className="space-y-3">{item.isRequired ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>图片要求：至少上传 {requiredImageCount(item)} 张</b><span className="ml-2 text-xs">已完成 0/{requiredImageCount(item)}</span></div> : null}<button className="ui-button-secondary" onClick={() => undefined} type="button"><Camera className="h-4 w-4" />上传图片</button></div> : null}
  </div>;
}

export function TaskExecutionPreview({
  draft,
  dueLabel,
  inventoryCategoryCodes,
  inventoryLinkEnabled,
  onClose,
  relatedContent,
}: {
  draft: TaskTemplateDraft;
  dueLabel: string;
  inventoryCategoryCodes: ProductCategoryCode[];
  inventoryLinkEnabled: boolean;
  onClose: () => void;
  relatedContent: RelatedPreview;
}) {
  const itemCount = useMemo(() => draft.groups.reduce((count, group) => count + group.items.length, 0), [draft.groups]);
  return <div aria-label="任务员工页面预览" aria-modal="true" className="fixed inset-0 z-[70] h-[100dvh] overflow-y-auto bg-canvas" role="dialog">
    <div className="mx-auto max-w-3xl space-y-3 px-3 pb-32 pt-3 sm:px-5 sm:pt-5">
      <header className="ui-card sticky top-0 z-20 flex items-center justify-between gap-3 p-3.5">
        <div className="min-w-0"><p className="text-xs font-bold text-brand-700">门店运营系统 · 任务执行</p><h1 className="truncate text-xl font-bold text-slate-900">{draft.name}</h1></div>
        <button aria-label="关闭任务预览" className="ui-icon-button" onClick={onClose} type="button"><X className="h-5 w-5" /></button>
      </header>
      <FeedbackBanner title="预览模式" tone="warning"><p>这里与员工收到任务后的填写页面保持一致。预览中的填写不会保存或提交。</p></FeedbackBanner>
      <section className="ui-card p-4"><div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-600">截止时间：{dueLabel}</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">待完成</span></div><div className="mt-3 flex justify-between text-sm"><span className="text-slate-600">填写进度</span><b className="tabular-nums">0%</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-2 w-0 rounded-full bg-brand-600" /></div>{draft.description ? <p className="mt-3 text-sm leading-6 text-slate-600">{draft.description}</p> : null}</section>
      {relatedContent ? <article className="ui-card flex items-center gap-3 border-brand-100 bg-brand-50 p-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700">{relatedContent.type === 'sop' ? <BookOpenCheck className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-brand-700">{relatedContent.type === 'sop' ? '任务关联 SOP' : '任务关联公告'}</span><b className="mt-0.5 block truncate text-slate-900">{relatedContent.title}</b></span><span className="inline-flex shrink-0 items-center text-sm font-bold text-brand-700">查看<ChevronRight className="h-4 w-4" /></span></article> : null}
      {inventoryLinkEnabled ? <article className="ui-card flex items-center gap-3 border-brand-100 bg-brand-50 p-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700"><ClipboardList className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-brand-700">任务关联点货 · 提交后任务才可完成</span><b className="mt-0.5 block truncate text-slate-900">{inventoryCategoryCodes.map(productCategoryLabel).join('、')}</b></span><span className="inline-flex shrink-0 items-center text-sm font-bold text-brand-700">去点货<ChevronRight className="h-4 w-4" /></span></article> : null}
      {draft.groups.map((group, groupIndex) => <section key={group.id}><div className="mb-2 flex items-center gap-2 px-1"><span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-bold text-white">分组 {groupIndex + 1}</span><div><h2 className="font-bold text-slate-800">{group.title}</h2>{group.description ? <p className="text-xs text-slate-500">{group.description}</p> : null}</div></div><div className="space-y-3">{group.items.map((item, itemIndex) => <article className="ui-card p-4" key={item.id}><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{groupIndex + 1}.{itemIndex + 1}</span><h3 className="font-bold">{item.label}{item.isRequired ? <span className="ml-1 text-red-600">*</span> : null}</h3></div>{item.guidance ? <p className="mt-1 text-sm leading-5 text-slate-500">{item.guidance}</p> : null}<TaskReferenceImagePreview loading={item.referenceImagePaths.length > item.referenceImageUrls.length} urls={item.referenceImageUrls} /><PreviewField item={item} /></article>)}</div></section>)}
      {itemCount === 0 ? <p className="ui-card p-5 text-sm text-slate-500">此模板暂无任务项目。</p> : null}
    </div>
    <MobileActionBar className="grid grid-cols-2 gap-2.5"><button className="ui-button-secondary" onClick={() => undefined} type="button"><Save className="h-5 w-5" />保存</button><button className="ui-button-primary" onClick={() => undefined} type="button"><Send className="h-5 w-5" />提交检查</button></MobileActionBar>
  </div>;
}
