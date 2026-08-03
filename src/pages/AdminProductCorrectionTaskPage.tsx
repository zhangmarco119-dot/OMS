import { ArrowLeft, Rocket } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { PageShell } from '../components/layout/PageShell';
import {
  clearProductCorrectionTaskDraft,
  loadProductCorrectionRecipients,
  loadProductCorrectionTaskDraft,
  publishProductCorrectionTasks,
} from '../features/admin/productCorrectionTask';
import { productCategoryLabel } from '../features/products/productCategories';
import type { TaskAudience, V2TaskCompletionMode, V2TaskRecipient } from '../services/v2-tasks.service';

const datetimeLocal = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const recipientAudience = (recipient: V2TaskRecipient): TaskAudience =>
  recipient.employment_type === 'part_time' ? 'part_time' : recipient.role === 'manager' ? 'manager' : 'staff';

export function AdminProductCorrectionTaskPage() {
  const navigate = useNavigate();
  const draft = useMemo(loadProductCorrectionTaskDraft, []);
  const [recipients, setRecipients] = useState<V2TaskRecipient[]>([]);
  const [mode, setMode] = useState<V2TaskCompletionMode>('single');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [targetAudiences, setTargetAudiences] = useState<TaskAudience[]>(['staff', 'manager']);
  const [managerReviewEnabled, setManagerReviewEnabled] = useState(false);
  const [publishMode, setPublishMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [publishAt, setPublishAt] = useState(datetimeLocal(new Date(Date.now() + 60 * 60 * 1000)));
  const [dueAt, setDueAt] = useState(datetimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    loadProductCorrectionRecipients(draft.storeId)
      .then(setRecipients)
      .catch((error) => setMessage(error instanceof Error ? error.message : '接收人加载失败'));
  }, [draft]);

  const matchingRecipientIds = recipients.filter((recipient) => targetAudiences.includes(recipientAudience(recipient))).map((recipient) => recipient.id);
  const publish = async () => {
    if (!draft) return;
    const effectivePublishAt = publishMode === 'scheduled' ? new Date(publishAt) : new Date();
    const effectiveDueAt = new Date(dueAt);
    if (Number.isNaN(effectivePublishAt.getTime()) || Number.isNaN(effectiveDueAt.getTime()) || effectiveDueAt <= effectivePublishAt) {
      setMessage('验收截止时间必须晚于发布时间。');
      return;
    }
    if (!['single', 'selected'].includes(mode) && !targetAudiences.length) {
      setMessage('请至少勾选一个接收范围。');
      return;
    }
    if (mode === 'single' && !selectedProfileId) {
      setMessage('请选择一位任务接收人。');
      return;
    }
    if (mode === 'selected' && selectedProfileIds.length < 2) {
      setMessage('请至少选择两位需要分别完成任务的人员。');
      return;
    }
    if (mode === 'individual' && matchingRecipientIds.length === 0) {
      setMessage('当前接收范围内没有可接收任务的人员。');
      return;
    }

    const profileIds = mode === 'single' ? [selectedProfileId] : mode === 'selected' ? selectedProfileIds : mode === 'individual' ? matchingRecipientIds : [];
    const audiences = profileIds.length
      ? [...new Set(recipients.filter((recipient) => profileIds.includes(recipient.id)).map(recipientAudience))]
      : targetAudiences;
    setBusy(true);
    try {
      const tasks = await publishProductCorrectionTasks({
        dueAt: effectiveDueAt.toISOString(),
        items: draft.items,
        managerReviewEnabled,
        profileIds,
        publishAt: effectivePublishAt.toISOString(),
        storeId: draft.storeId,
        targetAudiences: audiences,
      });
      clearProductCorrectionTaskDraft();
      window.dispatchEvent(new Event('storehub:todos-changed'));
      setMessage(`${publishMode === 'scheduled' ? '更正任务已定时发布' : '更正任务已发布'}，共生成 ${tasks.length} 条任务。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '更正任务发布失败');
    } finally {
      setBusy(false);
    }
  };

  if (!draft) {
    return <PageShell eyebrow="门店运营系统 · 管理员" title="发布货品更正任务" backTo="/app/admin/products"><section className="ui-card p-4"><p className="text-sm text-slate-600">没有待发布的货品，请返回货品管理重新勾选。</p><Link className="ui-button-primary mt-3 w-full" to="/app/admin/products"><ArrowLeft className="h-4 w-4" />返回货品管理</Link></section></PageShell>;
  }

  return <PageShell eyebrow="门店运营系统 · 管理员" title="发布货品更正任务" backTo="/app/admin/products">
    <section className="ui-card p-4">
      <h2 className="font-bold">任务内容</h2>
      <p className="mt-1 text-sm text-slate-600">{draft.storeName} · 共 {draft.items.length} 项。接收人将逐项填写，审核人可逐项通过或驳回。</p>
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {draft.items.map((item, index) => <article className="rounded-lg bg-slate-50 px-3 py-2 text-sm" key={`${item.product_action}:${item.product_id ?? item.source_key ?? index}`}>
          <b>{index + 1}. {item.name}</b>
          <p className="mt-1 text-xs leading-5 text-slate-500">{item.spec || '规格待填写'} · {item.count_unit || '单位待填写'} · {productCategoryLabel(item.category_code)} · {item.product_action === 'create' ? '推荐新增' : '更正现有货品'}</p>
        </article>)}
      </div>
    </section>

    <section className="ui-card p-4">
      <h2 className="font-bold">发布范围</h2>
      <label className="mt-3 block text-sm font-semibold">完成方式<select aria-label="货品更正任务完成方式" className="ui-input mt-1" onChange={(event) => setMode(event.target.value as V2TaskCompletionMode)} value={mode}><option value="shared">所选范围共同完成一次</option><option value="individual">所选范围每人分别完成一次</option><option value="single">单独指定一人完成</option><option value="selected">指定多人分别完成一次</option></select></label>
      {mode === 'single' ? <label className="mt-3 block text-sm font-semibold">接收人<select aria-label="货品更正任务接收人" className="ui-input mt-1" onChange={(event) => setSelectedProfileId(event.target.value)} value={selectedProfileId}><option value="">请选择人员</option>{recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.display_name} · {recipientAudience(recipient) === 'part_time' ? '兼职' : recipient.role === 'manager' ? '店长' : '员工'}</option>)}</select></label> : null}
      {mode === 'selected' ? <fieldset className="mt-3"><legend className="text-sm font-semibold">指定人员（可多选）</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{recipients.map((recipient) => <label className="flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-sm" key={recipient.id}><input checked={selectedProfileIds.includes(recipient.id)} className="mr-2" onChange={(event) => setSelectedProfileIds((current) => event.target.checked ? [...current, recipient.id] : current.filter((id) => id !== recipient.id))} type="checkbox" />{recipient.display_name} · {recipientAudience(recipient) === 'part_time' ? '兼职' : recipient.role === 'manager' ? '店长' : '员工'}</label>)}</div></fieldset> : null}
      {!['single', 'selected'].includes(mode) ? <fieldset className="mt-3"><legend className="text-sm font-semibold">接收范围（可多选）</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['staff', '员工'], ['manager', '店长'], ['part_time', '兼职']] as const).map(([value, label]) => <label className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 px-2 text-sm" key={value}><input checked={targetAudiences.includes(value)} onChange={(event) => setTargetAudiences((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} type="checkbox" />{label}</label>)}</div>{mode === 'individual' ? <p className="mt-2 text-xs text-slate-500">将为当前 {matchingRecipientIds.length} 人分别创建任务。</p> : null}</fieldset> : null}
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm"><input checked={managerReviewEnabled} className="mt-1" onChange={(event) => setManagerReviewEnabled(event.target.checked)} type="checkbox" /><span><b className="block text-brand-900">允许店长审核员工提交</b><span className="mt-1 block text-xs text-brand-800">管理员始终可以审核；店长只能审核本门店员工提交的任务。</span></span></label>
    </section>

    <section className="ui-card p-4">
      <h2 className="font-bold">发布时间与截止时间</h2>
      <div className="mt-3 grid grid-cols-2 gap-2"><label className="rounded-lg border p-2 text-sm"><input checked={publishMode === 'immediate'} onChange={() => setPublishMode('immediate')} type="radio" /> 立即发布</label><label className="rounded-lg border p-2 text-sm"><input checked={publishMode === 'scheduled'} onChange={() => setPublishMode('scheduled')} type="radio" /> 定时发布</label></div>
      {publishMode === 'scheduled' ? <label className="mt-3 block text-sm font-semibold">定时发布时间<input className="ui-input mt-1" onChange={(event) => setPublishAt(event.target.value)} type="datetime-local" value={publishAt} /></label> : null}
      <label className="mt-3 block text-sm font-semibold">验收截止时间<input className="ui-input mt-1" onChange={(event) => setDueAt(event.target.value)} type="datetime-local" value={dueAt} /></label>
      <button className="ui-button-primary mt-4 w-full" disabled={busy} onClick={() => void publish()} type="button"><Rocket className="h-4 w-4" />{busy ? '正在发布' : '确认发布更正任务'}</button>
    </section>
    <ActionFeedbackDialog message={message ?? ''} onClose={() => { const success = message?.includes('任务已'); setMessage(null); if (success) navigate('/app/admin/tasks'); }} open={Boolean(message)} title="操作提示" tone={message?.includes('任务已') ? 'success' : 'warning'} />
  </PageShell>;
}
