import { Camera, CheckCircle2, ClipboardCopy, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { FormField, SegmentedControl } from '../components/ui/FormField';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { buildOperationReportText, getMissingOperationReportFields, type OperationReportField, type RefundEntry } from '../features/operation-reports/reportText';
import { supabase } from '../lib/supabase';
import { loadOperationReportImages, removeOperationReportImage, uploadOperationReportImage, type OperationReportImage } from '../services/operation-report-images.service';
import {
  addOperationReportRefundReason,
  deleteOperationReportRefundReason,
  getOperationReportAvailability,
  getOperationReportDraft,
  listOperationReports,
  saveOperationReportDraft,
  saveOperationReportTemplate,
  submitOperationReport,
  syncOperationReportSources,
  updateOperationReportRefundReason,
  type OperationReport,
  type OperationReportAvailability,
  type OperationReportRefundReason,
} from '../services/operation-reports.service';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const stageCopy = { pos: '正在拉取银豹收银数据', prepare: '正在读取数据库考勤并生成报告' } as const;

export function OperationReportsPage() {
  const auth = useAuth();
  const isAdmin = auth.profile?.role === 'admin';
  const [tab, setTab] = useState<'create' | 'reports' | 'config'>(isAdmin ? 'reports' : 'create');
  const [selectedStoreId, setSelectedStoreId] = useState(auth.store?.id ?? '');
  const storeId = isAdmin ? selectedStoreId : auth.store?.id ?? '';
  const [availability, setAvailability] = useState<OperationReportAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reports, setReports] = useState<OperationReport[]>([]);

  const reload = useCallback(async () => {
    if (!storeId) return;
    setLoading(true); setError('');
    try {
      const [available, reportRows] = await Promise.all([getOperationReportAvailability(storeId), listOperationReports(storeId)]);
      setAvailability(available); setReports(reportRows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '运营报告加载失败。'); }
    finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => { void reload(); }, [reload]);

  const tabItems = isAdmin ? [
    { active: tab === 'reports', label: '报告记录', onClick: () => setTab('reports' as const) },
    { active: tab === 'config', label: '模板配置', onClick: () => setTab('config' as const) },
  ] : [
    { active: tab === 'create', label: '生成报告', onClick: () => setTab('create' as const) },
    { active: tab === 'reports', label: '历史报告', onClick: () => setTab('reports' as const) },
  ];

  return <PageShell backTo="/app/workbench" eyebrow="门店运营" title="运营报告">
    {isAdmin ? <SectionCard><FormField label="配置门店"><select className="ui-input" value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)}>{auth.availableStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></FormField></SectionCard> : null}
    <SegmentedControl className="grid-cols-2" items={tabItems} />
    {loading ? <LoadingState label="正在加载运营报告" /> : error ? <ErrorState message={error} onRetry={() => void reload()} /> : !availability?.available ? <EmptyState title="当前门店暂未启用运营报告" description="运营报告目前仅开放给已连接银豹收银系统的西直门店。" /> : tab === 'create' ? <ReportComposer availability={availability} onSubmitted={() => void reload()} storeId={storeId} /> : tab === 'config' ? <ReportTemplateEditor availability={availability} onSaved={() => void reload()} storeId={storeId} /> : <ReportList reports={reports} />}
  </PageShell>;
}

function ReportList({ reports }: { reports: OperationReport[] }) {
  if (!reports.length) return <EmptyState title="暂无运营报告" description="员工提交后，报告会显示在这里。" />;
  return <div className="space-y-2">{reports.map((report) => <Link className="ui-card ui-interactive block p-4" key={report.id} to={`/app/operation-reports/${report.id}`}><div className="flex items-center justify-between gap-3"><div><p className="font-bold text-slate-900">{report.report_date} · {report.title_snapshot}</p><p className="mt-1 text-xs text-slate-500">销售额 ¥{Number(report.computed_data.sales_amount ?? 0).toFixed(2)} · TC {String(report.computed_data.transaction_count ?? 0)}</p></div><StatusBadge tone={report.status === 'submitted' ? 'success' : 'warning'}>{report.status === 'submitted' ? '已提交' : '草稿'}</StatusBadge></div></Link>)}</div>;
}

function ReportComposer({ availability, onSubmitted, storeId }: { availability: OperationReportAvailability; onSubmitted: () => void; storeId: string }) {
  const auth = useAuth();
  const [date, setDate] = useState(today());
  const [report, setReport] = useState<OperationReport | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [refunds, setRefunds] = useState<RefundEntry[]>([]);
  const [reasonOptions, setReasonOptions] = useState<OperationReportRefundReason[]>(availability.refundReasons ?? []);
  const [images, setImages] = useState<Record<string, OperationReportImage>>({});
  const [stage, setStage] = useState<keyof typeof stageCopy | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [restoring, setRestoring] = useState(true);
  const [feedback, setFeedback] = useState<{ message: string; title: string; tone: 'success' | 'warning' } | null>(null);
  const interval = useRef<number>();
  const fields = useMemo(() => report?.field_config_snapshot ?? availability.fields ?? [], [availability.fields, report?.field_config_snapshot]);

  useEffect(() => () => window.clearInterval(interval.current), []);
  useEffect(() => setReasonOptions(availability.refundReasons ?? []), [availability.refundReasons]);
  useEffect(() => {
    let active = true;
    setRestoring(true);
    setReport(null); setImages({}); setValues({}); setRefunds([]);
    void (async () => {
      try {
        const draft = await getOperationReportDraft(storeId, date);
        if (!active || !draft) return;
        setReport(draft); setValues(draft.manual_values ?? {}); setRefunds(draft.refund_entries ?? []);
        if (supabase) {
          const loaded = await loadOperationReportImages(supabase, draft.id);
          if (active) setImages(Object.fromEntries(loaded.map((image) => [image.field_id, image])));
        }
      } catch (cause) {
        if (active) setFeedback({ title: '草稿恢复失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' });
      } finally { if (active) setRestoring(false); }
    })();
    return () => { active = false; };
  }, [date, storeId]);

  useEffect(() => {
    if (!report || report.status !== 'draft' || restoring) return;
    const timer = window.setTimeout(() => {
      void saveOperationReportDraft(report.id, values, refunds).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [refunds, report, restoring, values]);

  const begin = async () => {
    setProgress(3); setStage('pos');
    interval.current = window.setInterval(() => setProgress((value) => Math.min(value + 2, 92)), 450);
    try {
      const result = await syncOperationReportSources(storeId, date, (next) => { setStage(next); setProgress(next === 'pos' ? 10 : 80); });
      const prepared = result.report;
      setReport(prepared); setValues(prepared.manual_values ?? {}); setRefunds(prepared.refund_entries ?? []); setProgress(100);
      if (supabase) {
        const loaded = await loadOperationReportImages(supabase, prepared.id);
        setImages(Object.fromEntries(loaded.map((image) => [image.field_id, image])));
      }
      setFeedback(result.cached
        ? { title: '已使用近期数据', message: '5 分钟内已有拉取结果，本次未重复调用收银或钉钉接口。', tone: 'warning' }
        : { title: '数据准备完成', message: '收银数据已更新，考勤已从数据库读取，请补充物料信息和照片。', tone: 'success' });
    } catch (cause) { setFeedback({ title: '数据拉取失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' }); }
    finally { window.clearInterval(interval.current); setStage(null); }
  };

  const upload = async (field: OperationReportField, file?: File) => {
    if (!file || !report || !auth.profile || !supabase) return;
    try {
      const image = await uploadOperationReportImage(supabase, { fieldId: field.id, file, profileId: auth.profile.id, reportId: report.id, storeId }, (value) => setUploading((current) => ({ ...current, [field.id]: value })));
      setImages((current) => ({ ...current, [field.id]: image }));
    } catch (cause) { setFeedback({ title: '照片上传失败', message: cause instanceof Error ? cause.message : '请重新选择照片。', tone: 'warning' }); }
    finally { setUploading((current) => { const next = { ...current }; delete next[field.id]; return next; }); }
  };
  const removeImage = async (fieldId: string) => {
    const image = images[fieldId]; if (!image || !supabase) return;
    try { await removeOperationReportImage(supabase, image); setImages((current) => { const next = { ...current }; delete next[fieldId]; return next; }); }
    catch (cause) { setFeedback({ title: '照片删除失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' }); }
  };
  const updateRefund = (index: number, patch: Partial<RefundEntry>) => {
    setRefunds((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item));
  };
  const chooseRefundReason = (index: number, value: string) => {
    if (value === '__custom__') {
      updateRefund(index, { reason: '', reasonMode: 'custom' });
      return;
    }
    updateRefund(index, {
      reason: value,
      reasonMode: value ? 'preset' : undefined,
    });
  };
  const saveCustomRefundReason = async (index: number) => {
    const label = refunds[index]?.reason.trim();
    if (!label) return;
    try {
      const saved = await addOperationReportRefundReason(label);
      setReasonOptions((current) => current.some((item) => item.id === saved.id)
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((left, right) => left.displayOrder - right.displayOrder));
      updateRefund(index, { reason: saved.label, reasonMode: 'preset' });
    } catch (cause) {
      setFeedback({
        title: '退款原因保存失败',
        message: cause instanceof Error ? cause.message : '请稍后重试。',
        tone: 'warning',
      });
    }
  };
  const text = useMemo(() => report ? buildOperationReportText({ computed: report.computed_data, date: report.report_date, fields, manualValues: values, refundNote: report.refund_note_snapshot, refunds, title: report.title_snapshot }) : '', [fields, refunds, report, values]);
  const missingFields = () => getMissingOperationReportFields(fields, values, Object.keys(images));
  const requireComplete = () => {
    const missing = missingFields();
    if (missing.length) {
      setFeedback({ title: '请完善必填项', message: `请填写必填内容并上传所需照片：${missing.map((item) => item.label).join('、')}`, tone: 'warning' });
      return false;
    }
    const missingRefundReasons = refunds.filter((item) => !item.reason.trim());
    if (missingRefundReasons.length) {
      setFeedback({
        title: '请选择退款原因',
        message: `还有 ${missingRefundReasons.length} 笔退款没有填写原因，请选择已有原因或填写其他原因。`,
        tone: 'warning',
      });
      return false;
    }
    return true;
  };
  const submit = async () => {
    if (!report) return;
    if (!requireComplete()) return;
    try { const saved = await submitOperationReport(report.id, values, refunds, text); setReport(saved); setFeedback({ title: '报告已生成', message: '报告已推送给店长和管理员，现在可以一键复制纯文字内容。', tone: 'success' }); onSubmitted(); }
    catch (cause) { setFeedback({ title: '提交失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' }); }
  };
  const copy = async () => {
    if (!requireComplete()) return;
    await navigator.clipboard.writeText(text); setFeedback({ title: '复制成功', message: '纯文字运营报告已复制到剪贴板。', tone: 'success' });
  };

  return <>
    <SectionCard><SectionHeader icon={FileText} title="选择报告日期" description="生成时更新当日收银数据，考勤直接使用数据库最近一次同步结果；5 分钟内重复生成会复用上次结果。" /><div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><input className="ui-input" max={today()} type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button className="ui-button-primary px-4" disabled={Boolean(stage) || restoring} onClick={() => void begin()} type="button">{stage || restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{restoring ? '恢复草稿' : report ? '重新生成' : '拉取并生成'}</button></div>{stage ? <div className="mt-4"><div className="flex justify-between text-sm font-semibold text-brand-800"><span>{stageCopy[stage]}</span><span>{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div></div> : null}{report?.source_synced_at ? <p className="mt-2 text-xs text-slate-500">当前结果已保存 · 数据时间 {new Date(report.source_synced_at).toLocaleString('zh-CN')}</p> : null}</SectionCard>
    {report ? <>
      <SectionCard><SectionHeader icon={CheckCircle2} title="自动数据" description="以下内容来自最新收银数据和数据库中已同步的考勤。" /><div className="mt-3 grid grid-cols-2 gap-2 text-sm">{fields.filter((field) => field.kind === 'computed' && field.enabled !== false).map((field) => <div className="rounded-lg bg-slate-50 p-3" key={field.id}><p className="text-xs text-slate-500">{field.label}</p><p className="mt-1 font-bold text-slate-900">{String(report.computed_data[field.id] ?? '-')}</p></div>)}</div></SectionCard>
      <div className="space-y-3">{fields.filter((field) => field.kind === 'manual' && field.enabled !== false).map((field) => <SectionCard key={field.id}><FormField label={field.label} required={field.required} hint={`${field.requiresPhoto ? '需上传一张现场照片' : ''}${field.unit ? ` · 单位：${field.unit}` : ''}`}><input className="ui-input" value={values[field.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} /></FormField><div className="mt-3">{images[field.id] ? <div className="relative overflow-hidden rounded-xl border border-slate-200"><img alt={`${field.label}现场照片`} className="h-44 w-full object-contain bg-slate-50" src={images[field.id].signedUrl} /><button aria-label={`删除${field.label}照片`} className="absolute right-2 top-2 rounded-lg bg-white/95 p-2 text-red-700 shadow" onClick={() => void removeImage(field.id)} type="button"><Trash2 className="h-4 w-4" /></button></div> : <label className="ui-button-secondary w-full cursor-pointer"><Camera className="h-4 w-4" />{uploading[field.id] != null ? `正在上传 ${uploading[field.id]}%` : '拍摄或上传照片'}<input accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={uploading[field.id] != null} onChange={(event) => void upload(field, event.target.files?.[0])} type="file" /></label>}</div></SectionCard>)}</div>
      <SectionCard>
        <SectionHeader title="外卖平台退款" description="平台序号、产品和订单总金额已自动列出；退款原因需要手动选择。" />
        {refunds.length ? <div className="mt-3 space-y-3">{refunds.map((refund, index) => {
          const platformName = refund.platform === 'meituan' ? '美团' : refund.platform === 'eleme' ? '饿了么' : '其他渠道';
          const sequence = refund.platformSequence ?? refund.orderNumber ?? '未提供';
          const selectedReason = refund.reasonMode === 'custom'
            ? '__custom__'
            : reasonOptions.some((item) => item.label === refund.reason)
              ? refund.reason
              : refund.reason
                ? '__custom__'
                : '';
          return <div className="rounded-xl border border-slate-200 p-3" key={refund.ticketId ?? index}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">{platformName} · {sequence === '未提供' ? '序号未提供' : `${sequence}号`}</p>
                <p className="mt-1 text-sm text-slate-700">{refund.productSummary?.trim() || '产品信息未提供'}</p>
              </div>
              <p className="shrink-0 text-sm font-bold text-brand-800">¥{Number(refund.orderTotalAmount ?? 0).toFixed(2)}</p>
            </div>
            <div className="mt-3"><FormField label="退款原因" required>
                <select className="ui-input" value={selectedReason} onChange={(event) => chooseRefundReason(index, event.target.value)}>
                  <option value="">请选择退款原因</option>
                  {reasonOptions.filter((item) => item.isActive).map((item) =>
                    <option key={item.id} value={item.label}>{item.label}</option>)}
                  <option value="__custom__">其他原因（手动填写）</option>
                </select>
              </FormField></div>
            {selectedReason === '__custom__' ? <input
              className="ui-input mt-2"
              maxLength={80}
              onBlur={() => void saveCustomRefundReason(index)}
              onChange={(event) => updateRefund(index, { reason: event.target.value, reasonMode: 'custom' })}
              placeholder="请输入其他退款原因"
              value={refund.reason}
            /> : null}
          </div>;
        })}</div> : <p className="mt-3 text-sm text-slate-500">当日未识别到外卖退单。</p>}
      </SectionCard>
      <SectionCard><SectionHeader title="纯文字报告预览" /><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{text}</pre><div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => void copy()} type="button"><ClipboardCopy className="h-4 w-4" />一键复制</button><button className="ui-button-primary" disabled={report.status === 'submitted'} onClick={() => void submit()} type="button"><Save className="h-4 w-4" />{report.status === 'submitted' ? '已提交' : '生成并推送'}</button></div></SectionCard>
    </> : null}
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone ?? 'success'} />
  </>;
}

function ReportTemplateEditor({ availability, onSaved, storeId }: { availability: OperationReportAvailability; onSaved: () => void; storeId: string }) {
  const [title, setTitle] = useState(availability.title ?? '每日营运报告');
  const [fields, setFields] = useState<OperationReportField[]>(availability.fields ?? []);
  const [note, setNote] = useState(availability.refundNote ?? '');
  const [reasonOptions, setReasonOptions] = useState<OperationReportRefundReason[]>(availability.refundReasons ?? []);
  const [newReason, setNewReason] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; title: string; tone: 'success' | 'warning' } | null>(null);
  useEffect(() => setReasonOptions(availability.refundReasons ?? []), [availability.refundReasons]);
  const save = async () => { try { await saveOperationReportTemplate(storeId, title, fields, note, true); setFeedback({ title: '保存成功', message: '员工下次生成报告时将使用最新模板。', tone: 'success' }); onSaved(); } catch (cause) { setFeedback({ title: '保存失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' }); } };
  const update = (index: number, patch: Partial<OperationReportField>) => setFields((current) => current.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field));
  const add = () => setFields((current) => [...current, { enabled: true, id: `material_${Date.now()}`, kind: 'manual', label: '新物料', required: true, requiresPhoto: true, unit: '' }]);
  const addReason = async () => {
    const label = newReason.trim();
    if (!label) {
      setFeedback({ title: '请输入退款原因', message: '退款原因不能为空。', tone: 'warning' });
      return;
    }
    try {
      const saved = await addOperationReportRefundReason(label);
      setReasonOptions((current) => current.some((item) => item.id === saved.id)
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved].sort((left, right) => left.displayOrder - right.displayOrder));
      setNewReason('');
      setFeedback({ title: '添加成功', message: '员工填写退款原因时可以立即选择该选项。', tone: 'success' });
    } catch (cause) {
      setFeedback({ title: '添加失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' });
    }
  };
  const renameReason = async (reason: OperationReportRefundReason) => {
    const label = reason.label.trim();
    if (!label) {
      setFeedback({ title: '退款原因不能为空', message: '请填写退款原因后再保存。', tone: 'warning' });
      return;
    }
    try {
      const saved = await updateOperationReportRefundReason(reason.id, label);
      setReasonOptions((current) => current.map((item) => item.id === saved.id ? saved : item));
      setFeedback({ title: '修改成功', message: '退款原因选项已更新。', tone: 'success' });
    } catch (cause) {
      setFeedback({ title: '修改失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' });
    }
  };
  const removeReason = async (reason: OperationReportRefundReason) => {
    try {
      await deleteOperationReportRefundReason(reason.id);
      setReasonOptions((current) => current.filter((item) => item.id !== reason.id));
      setFeedback({ title: '删除成功', message: '该选项不会再出现在员工的退款原因列表中。', tone: 'success' });
    } catch (cause) {
      setFeedback({ title: '删除失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' });
    }
  };
  return <>
    <SectionCard><FormField label="报告标题"><input className="ui-input" value={title} onChange={(event) => setTitle(event.target.value)} /></FormField></SectionCard>
    <div className="space-y-2">{fields.map((field, index) => <SectionCard key={field.id}><div className="flex items-center gap-2"><input checked={field.enabled !== false} onChange={(event) => update(index, { enabled: event.target.checked })} type="checkbox" /><input className="ui-input flex-1" disabled={field.kind === 'computed'} value={field.label} onChange={(event) => update(index, { label: event.target.value })} />{field.kind === 'manual' ? <button aria-label="删除字段" className="ui-icon-button text-red-700" onClick={() => setFields((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 className="h-4 w-4" /></button> : null}</div>{field.kind === 'manual' ? <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-2"><input className="ui-input" placeholder="单位（可留空）" value={field.unit ?? ''} onChange={(event) => update(index, { unit: event.target.value })} /><label className="text-xs"><input checked={field.required ?? false} onChange={(event) => update(index, { required: event.target.checked })} type="checkbox" /> 必填</label><label className="text-xs"><input checked={field.requiresPhoto ?? false} onChange={(event) => update(index, { requiresPhoto: event.target.checked })} type="checkbox" /> 照片</label></div> : <p className="mt-2 text-xs text-slate-500">自动拉取字段</p>}</SectionCard>)}</div>
    <button className="ui-button-secondary w-full" onClick={add} type="button"><Plus className="h-4 w-4" />增加物料填写项</button>
    <SectionCard><FormField label="退款报告备注"><textarea className="ui-textarea" rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></FormField></SectionCard>
    <SectionCard>
      <SectionHeader title="退款原因选项" description="员工选择“其他原因”并填写后，也会自动加入这里。" />
      <div className="mt-3 space-y-2">
        {reasonOptions.map((reason) => <div className="grid grid-cols-[1fr_auto_auto] gap-2" key={reason.id}>
          <input
            className="ui-input"
            maxLength={80}
            onChange={(event) => setReasonOptions((current) => current.map((item) =>
              item.id === reason.id ? { ...item, label: event.target.value } : item))}
            value={reason.label}
          />
          <button aria-label={`保存${reason.label}`} className="ui-button-secondary px-3" onClick={() => void renameReason(reason)} type="button"><Save className="h-4 w-4" /></button>
          <button aria-label={`删除${reason.label}`} className="ui-icon-button text-red-700" onClick={() => void removeReason(reason)} type="button"><Trash2 className="h-4 w-4" /></button>
        </div>)}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <input className="ui-input" maxLength={80} onChange={(event) => setNewReason(event.target.value)} placeholder="新增退款原因" value={newReason} />
        <button className="ui-button-secondary px-4" onClick={() => void addReason()} type="button"><Plus className="h-4 w-4" />添加</button>
      </div>
    </SectionCard>
    <button className="ui-button-primary w-full" onClick={() => void save()} type="button"><Save className="h-4 w-4" />保存模板配置</button>
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone ?? 'success'} />
  </>;
}
