import { Camera, CheckCircle2, ClipboardCopy, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/layout/PageShell';
import { ActionFeedbackDialog } from '../components/feedback/ActionFeedbackDialog';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../components/ui/Feedback';
import { FormField, SegmentedControl } from '../components/ui/FormField';
import { SectionCard, SectionHeader } from '../components/ui/Surface';
import { useAuth } from '../features/auth/AuthContext';
import { buildOperationReportText, type OperationReportField, type RefundEntry } from '../features/operation-reports/reportText';
import { supabase } from '../lib/supabase';
import { loadOperationReportImages, removeOperationReportImage, uploadOperationReportImage, type OperationReportImage } from '../services/operation-report-images.service';
import { getOperationReportAvailability, listOperationReports, saveOperationReportTemplate, submitOperationReport, syncOperationReportSources, type OperationReport, type OperationReportAvailability } from '../services/operation-reports.service';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const stageCopy = { pos: '正在拉取银豹收银数据', attendance: '正在拉取钉钉考勤数据', prepare: '正在生成运营数据' } as const;

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
  const [images, setImages] = useState<Record<string, OperationReportImage>>({});
  const [stage, setStage] = useState<keyof typeof stageCopy | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<{ message: string; title: string; tone: 'success' | 'warning' } | null>(null);
  const interval = useRef<number>();
  const fields = useMemo(() => report?.field_config_snapshot ?? availability.fields ?? [], [availability.fields, report?.field_config_snapshot]);

  useEffect(() => () => window.clearInterval(interval.current), []);
  const begin = async () => {
    setReport(null); setImages({}); setValues({}); setRefunds([]); setProgress(3); setStage('pos');
    interval.current = window.setInterval(() => setProgress((value) => Math.min(value + 2, 92)), 450);
    try {
      const prepared = await syncOperationReportSources(storeId, date, (next) => { setStage(next); setProgress(next === 'pos' ? 5 : next === 'attendance' ? 45 : 85); });
      setReport(prepared); setValues(prepared.manual_values ?? {}); setRefunds(prepared.refund_entries ?? []); setProgress(100);
      if (supabase) {
        const loaded = await loadOperationReportImages(supabase, prepared.id);
        setImages(Object.fromEntries(loaded.map((image) => [image.field_id, image])));
      }
      setFeedback({ title: '数据拉取完成', message: '收银与考勤数据已更新，请补充物料信息和照片。', tone: 'success' });
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
  const text = useMemo(() => report ? buildOperationReportText({ computed: report.computed_data, date: report.report_date, fields, manualValues: values, refundNote: report.refund_note_snapshot, refunds, title: report.title_snapshot }) : '', [fields, refunds, report, values]);
  const submit = async () => {
    if (!report) return;
    const missing = fields.filter((field) => field.kind === 'manual' && field.enabled !== false && ((field.required && !values[field.id]?.trim()) || (field.requiresPhoto && !images[field.id])));
    if (missing.length) { setFeedback({ title: '请完善报告', message: `请填写并上传照片：${missing.map((item) => item.label).join('、')}`, tone: 'warning' }); return; }
    try { const saved = await submitOperationReport(report.id, values, refunds, text); setReport(saved); setFeedback({ title: '报告已生成', message: '报告已推送给店长和管理员，现在可以一键复制纯文字内容。', tone: 'success' }); onSubmitted(); }
    catch (cause) { setFeedback({ title: '提交失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' }); }
  };
  const copy = async () => { await navigator.clipboard.writeText(text); setFeedback({ title: '复制成功', message: '纯文字运营报告已复制到剪贴板。', tone: 'success' }); };

  return <>
    <SectionCard><SectionHeader icon={FileText} title="选择报告日期" description="生成前会强制更新当日银豹收银与钉钉考勤数据。" /><div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><input className="ui-input" max={today()} type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button className="ui-button-primary px-4" disabled={Boolean(stage)} onClick={() => void begin()} type="button">{stage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{report ? '重新拉取' : '拉取并生成'}</button></div>{stage ? <div className="mt-4"><div className="flex justify-between text-sm font-semibold text-brand-800"><span>{stageCopy[stage]}</span><span>{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div></div> : null}</SectionCard>
    {report ? <>
      <SectionCard><SectionHeader icon={CheckCircle2} title="自动数据" description="以下内容来自刚刚完成的同步。" /><div className="mt-3 grid grid-cols-2 gap-2 text-sm">{fields.filter((field) => field.kind === 'computed' && field.enabled !== false).map((field) => <div className="rounded-lg bg-slate-50 p-3" key={field.id}><p className="text-xs text-slate-500">{field.label}</p><p className="mt-1 font-bold text-slate-900">{String(report.computed_data[field.id] ?? '-')}</p></div>)}</div></SectionCard>
      <div className="space-y-3">{fields.filter((field) => field.kind === 'manual' && field.enabled !== false).map((field) => <SectionCard key={field.id}><FormField label={field.label} required={field.required} hint={`${field.requiresPhoto ? '需上传一张现场照片' : ''}${field.unit ? ` · 单位：${field.unit}` : ''}`}><input className="ui-input" value={values[field.id] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} /></FormField><div className="mt-3">{images[field.id] ? <div className="relative overflow-hidden rounded-xl border border-slate-200"><img alt={`${field.label}现场照片`} className="h-44 w-full object-contain bg-slate-50" src={images[field.id].signedUrl} /><button aria-label={`删除${field.label}照片`} className="absolute right-2 top-2 rounded-lg bg-white/95 p-2 text-red-700 shadow" onClick={() => void removeImage(field.id)} type="button"><Trash2 className="h-4 w-4" /></button></div> : <label className="ui-button-secondary w-full cursor-pointer"><Camera className="h-4 w-4" />{uploading[field.id] != null ? `正在上传 ${uploading[field.id]}%` : '拍摄或上传照片'}<input accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={uploading[field.id] != null} onChange={(event) => void upload(field, event.target.files?.[0])} type="file" /></label>}</div></SectionCard>)}</div>
      <SectionCard><SectionHeader title="外卖平台退款" description="银豹能识别的退单已自动列出；接口未提供原因时请补充。" />{refunds.length ? <div className="mt-3 space-y-2">{refunds.map((refund, index) => <div className="rounded-xl border border-slate-200 p-3" key={refund.ticketId ?? index}><div className="flex justify-between text-sm font-bold"><span>{refund.platform === 'meituan' ? '美团' : refund.platform === 'eleme' ? '饿了么' : '其他渠道'}</span><span>订单号 {refund.orderNumber}</span></div><input className="ui-input mt-2" placeholder="退款原因（极速退款可留空）" value={refund.reason} onChange={(event) => setRefunds((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reason: event.target.value } : item))} /></div>)}</div> : <p className="mt-3 text-sm text-slate-500">当日未识别到外卖退单。</p>}</SectionCard>
      <SectionCard><SectionHeader title="纯文字报告预览" /><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{text}</pre><div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-button-secondary" onClick={() => void copy()} type="button"><ClipboardCopy className="h-4 w-4" />一键复制</button><button className="ui-button-primary" disabled={report.status === 'submitted'} onClick={() => void submit()} type="button"><Save className="h-4 w-4" />{report.status === 'submitted' ? '已提交' : '生成并推送'}</button></div></SectionCard>
    </> : null}
    <ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone ?? 'success'} />
  </>;
}

function ReportTemplateEditor({ availability, onSaved, storeId }: { availability: OperationReportAvailability; onSaved: () => void; storeId: string }) {
  const [title, setTitle] = useState(availability.title ?? '每日营运报告');
  const [fields, setFields] = useState<OperationReportField[]>(availability.fields ?? []);
  const [note, setNote] = useState(availability.refundNote ?? '');
  const [feedback, setFeedback] = useState<{ message: string; title: string; tone: 'success' | 'warning' } | null>(null);
  const save = async () => { try { await saveOperationReportTemplate(storeId, title, fields, note, true); setFeedback({ title: '保存成功', message: '员工下次生成报告时将使用最新模板。', tone: 'success' }); onSaved(); } catch (cause) { setFeedback({ title: '保存失败', message: cause instanceof Error ? cause.message : '请稍后重试。', tone: 'warning' }); } };
  const update = (index: number, patch: Partial<OperationReportField>) => setFields((current) => current.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field));
  const add = () => setFields((current) => [...current, { enabled: true, id: `material_${Date.now()}`, kind: 'manual', label: '新物料', required: true, requiresPhoto: true, unit: '' }]);
  return <><SectionCard><FormField label="报告标题"><input className="ui-input" value={title} onChange={(event) => setTitle(event.target.value)} /></FormField></SectionCard><div className="space-y-2">{fields.map((field, index) => <SectionCard key={field.id}><div className="flex items-center gap-2"><input checked={field.enabled !== false} onChange={(event) => update(index, { enabled: event.target.checked })} type="checkbox" /><input className="ui-input flex-1" disabled={field.kind === 'computed'} value={field.label} onChange={(event) => update(index, { label: event.target.value })} />{field.kind === 'manual' ? <button aria-label="删除字段" className="ui-icon-button text-red-700" onClick={() => setFields((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 className="h-4 w-4" /></button> : null}</div>{field.kind === 'manual' ? <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-2"><input className="ui-input" placeholder="单位（可留空）" value={field.unit ?? ''} onChange={(event) => update(index, { unit: event.target.value })} /><label className="text-xs"><input checked={field.required ?? false} onChange={(event) => update(index, { required: event.target.checked })} type="checkbox" /> 必填</label><label className="text-xs"><input checked={field.requiresPhoto ?? false} onChange={(event) => update(index, { requiresPhoto: event.target.checked })} type="checkbox" /> 照片</label></div> : <p className="mt-2 text-xs text-slate-500">自动拉取字段</p>}</SectionCard>)}</div><button className="ui-button-secondary w-full" onClick={add} type="button"><Plus className="h-4 w-4" />增加物料填写项</button><SectionCard><FormField label="退款报告备注"><textarea className="ui-textarea" rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></FormField></SectionCard><button className="ui-button-primary w-full" onClick={() => void save()} type="button"><Save className="h-4 w-4" />保存模板配置</button><ActionFeedbackDialog message={feedback?.message ?? ''} onClose={() => setFeedback(null)} open={Boolean(feedback)} title={feedback?.title ?? ''} tone={feedback?.tone ?? 'success'} /></>;
}
