import { ArrowLeft, ArrowRight, Ban, CheckCircle2, ChevronDown, ChevronUp, Clock3, FileDown, ListChecks, PackagePlus, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { canManageV1ProductsFromTask } from '../features/access/roleCapabilities';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../lib/supabase';
import { asProductSnapshot, type TaskItemRow } from '../features/tasks/taskCalculations';
import { useTaskSession } from '../features/tasks/useTaskSession';
import type { InventoryTemplate } from '../features/tasks/taskService';
import type { TaskType } from '../types/domain';

interface TaskRoutePageProps {
  mode: TaskType;
}

const copy = {
  inventory: {
    title: '点货',
    modeLabel: '盘点',
    quantityLabel: '盘点数量',
    processedLabel: '已点',
    pendingLabel: '待点',
    complete: '结束盘点',
    summaryTitle: '盘点汇总',
    summaryBody: '货品已清点完毕，可以返回修改或继续补充临时货品。',
  },
  order: {
    title: '订货',
    modeLabel: '订货',
    quantityLabel: '订货数量',
    processedLabel: '已订',
    pendingLabel: '待订',
    complete: '结束订货',
    summaryTitle: '订货汇总',
    summaryBody: '本次订货信息已填写完毕，可以返回修改或继续补充临时货品。',
  },
} satisfies Record<
  TaskType,
  {
    title: string;
    modeLabel: string;
    quantityLabel: string;
    processedLabel: string;
    pendingLabel: string;
    complete: string;
    summaryTitle: string;
    summaryBody: string;
  }
>;

const formatTemplateTime = (value: string | null) => {
  if (!value) {
    return '未记录时间';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

export function TaskRoutePage({ mode }: TaskRoutePageProps) {
  const auth = useAuth();

  if (auth.profile?.role === 'admin') {
    return (
      <PageShell eyebrow="管理员账号" title="管理员不执行点货和订货" backTo="/app">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="text-sm leading-6 text-slate-600">
            管理员账号用于查看提交消息、审阅全部记录以及维护货品和账号。请使用员工或店长账号完成门店点货、订货提交。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link className="min-h-12 rounded-lg bg-brand-600 px-4 py-3 text-center font-bold text-white" to="/app/history">
              查看提交记录
            </Link>
            <Link className="min-h-12 rounded-lg border border-slate-200 px-4 py-3 text-center font-bold text-slate-800" to="/app/admin">
              进入后台管理
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return <StaffTaskRoutePage mode={mode} />;
}

function StaffTaskRoutePage({ mode }: TaskRoutePageProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const text = copy[mode];
  // Both inventory and ordering are high-frequency mobile workflows. Keep the
  // same dense one-screen layout so switching modules does not reintroduce
  // unnecessary whitespace.
  const compact = true;
  const task = useTaskSession(mode);
  const [showSummary, setShowSummary] = useState(false);
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [showProcessedDrawer, setShowProcessedDrawer] = useState(false);
  const [showPendingDrawer, setShowPendingDrawer] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackActionMessage, setFeedbackActionMessage] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [showDeletionConfirm, setShowDeletionConfirm] = useState(false);
  const [correctionForm, setCorrectionForm] = useState({ name: '', spec: '', countUnit: '' });
  const [extraFormMessage, setExtraFormMessage] = useState<string | null>(null);
  const [extraFormBusy, setExtraFormBusy] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInventoryImport, setShowInventoryImport] = useState(false);
  const [inventoryTemplates, setInventoryTemplates] = useState<InventoryTemplate[]>([]);
  const [inventoryImportStatus, setInventoryImportStatus] = useState<'idle' | 'loading' | 'importing' | 'error'>('idle');
  const [inventoryImportMessage, setInventoryImportMessage] = useState<string | null>(null);
  const [extraForm, setExtraForm] = useState({ name: '', spec: '', countUnit: '', quantity: '', note: '' });
  const [productPermissions, setProductPermissions] = useState({ discontinued: false, incorrect: false, new: false });
  const isManager = canManageV1ProductsFromTask(auth.profile?.role);
  const canCorrectProduct = productPermissions.incorrect;
  const canRequestProductDeletion = productPermissions.discontinued;
  const snapshot = task.currentItem ? asProductSnapshot(task.currentItem.product_snapshot) : null;
  const progressStyle = { width: `${task.stats.percent}%` };
  const canGoPrevious = task.currentIndex > 0;
  const canGoNext = task.currentIndex < task.items.length - 1;
  const deletionRequested = task.currentItem?.product_action_status === 'deletion_requested';
  const deletionActionLocked = deletionRequested
    || task.currentItem?.product_action_status === 'deletion_approved'
    || (!task.currentItem?.product_id && Boolean(snapshot?.product_id));

  useEffect(() => {
    setFeedbackNote('');
    setFeedbackActionMessage(null);
    setShowCorrectionForm(false);
    setShowDeletionConfirm(false);
  }, [task.currentItem?.id]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    void Promise.all(['discontinued', 'incorrect', 'new'].map(async (feedbackType) => {
      const { data } = await client.rpc('can_request_product_feedback', { p_feedback_type: feedbackType });
      return [feedbackType, Boolean(data)] as const;
    })).then((entries) => setProductPermissions({ discontinued: entries.find(([type]) => type === 'discontinued')?.[1] ?? false, incorrect: entries.find(([type]) => type === 'incorrect')?.[1] ?? false, new: entries.find(([type]) => type === 'new')?.[1] ?? false }));
  }, []);

  const updateQuantity = (delta: number) => {
    const current = task.quantityInput.trim() === '' ? 0 : Number(task.quantityInput);
    const next = Number.isFinite(current) ? Math.max(0, current + delta) : Math.max(0, delta);
    task.setQuantityInput(String(next));
  };

  const finishTask = () => {
    if (mode === 'order' && task.stats.pending > 0) {
      task.goNextPending();
      return;
    }
    setShowSummary(true);
  };

  const openInventoryImport = async () => {
    setShowInventoryImport(true);
    setInventoryImportStatus('loading');
    setInventoryImportMessage(null);
    try {
      setInventoryTemplates(await task.getInventoryTemplates());
      setInventoryImportStatus('idle');
    } catch (error) {
      setInventoryImportStatus('error');
      setInventoryImportMessage(error instanceof Error ? error.message : '加载历史盘点单失败');
    }
  };

  const importInventoryTemplate = async (sourceTaskId: string) => {
    setInventoryImportStatus('importing');
    setInventoryImportMessage(null);
    try {
      await task.saveCurrentQuantityNow();
      await task.importFromInventoryTask(sourceTaskId);
      setShowInventoryImport(false);
      setShowSummary(false);
    } catch (error) {
      setInventoryImportStatus('error');
      setInventoryImportMessage(error instanceof Error ? error.message : '导入历史盘点单失败');
    }
  };

  const openCorrectionForm = () => {
    if (!snapshot) {
      return;
    }
    setCorrectionForm({
      name: snapshot.name,
      spec: snapshot.spec,
      countUnit: snapshot.count_unit,
    });
    setFeedbackActionMessage(null);
    setShowCorrectionForm(true);
  };

  const submitManagerCorrection = async () => {
    if (!correctionForm.name.trim() || !correctionForm.spec.trim() || !correctionForm.countUnit.trim()) {
      setFeedbackActionMessage('请填写货品名称、规格和单位。');
      return;
    }

    setFeedbackBusy(true);
    setFeedbackActionMessage(null);
    try {
      await task.correctCurrentProduct({
        name: correctionForm.name.trim(),
        spec: correctionForm.spec.trim(),
        countUnit: correctionForm.countUnit.trim(),
        note: feedbackNote || undefined,
      });
      setFeedbackNote('');
      setShowCorrectionForm(false);
      setFeedbackActionMessage('货品信息已修改，管理员已收到通知。');
    } catch (error) {
      setFeedbackActionMessage(error instanceof Error ? error.message : '修改货品信息失败');
    } finally {
      setFeedbackBusy(false);
    }
  };

  const confirmManagerDeletionRequest = async () => {
    if (!task.currentItem) {
      return;
    }

    setFeedbackBusy(true);
    setFeedbackActionMessage(null);
    try {
      await task.requestCurrentProductDeletion(feedbackNote || undefined);
      setFeedbackNote('');
      setShowDeletionConfirm(false);
      setFeedbackActionMessage('已提交删除此货品，等待管理员确认。');
    } catch (error) {
      setFeedbackActionMessage(error instanceof Error ? error.message : '提交删除申请失败');
    } finally {
      setFeedbackBusy(false);
    }
  };

  const submitExtraItem = async () => {
    const quantity = Number(extraForm.quantity);
    if (!extraForm.name || !extraForm.spec || !extraForm.countUnit || !Number.isFinite(quantity) || quantity < 0) {
      setExtraFormMessage('请填写货品名称、规格、单位和有效数量。');
      return;
    }

    setExtraFormBusy(true);
    setExtraFormMessage(null);
    try {
      const input = {
        name: extraForm.name.trim(),
        spec: extraForm.spec.trim(),
        countUnit: extraForm.countUnit.trim(),
        quantity,
        note: extraForm.note.trim() || undefined,
      };
      if (isManager) {
        await task.addManagerProduct(input);
      } else {
        await task.addExtraItem(input);
      }
      setExtraForm({ name: '', spec: '', countUnit: '', quantity: '', note: '' });
      setShowExtraForm(false);
      setShowSummary(false);
    } catch (error) {
      setExtraFormMessage(error instanceof Error ? error.message : '新增货品失败');
    } finally {
      setExtraFormBusy(false);
    }
  };

  const submitTaskOnly = async () => {
    if (mode === 'order' && task.stats.pending > 0) {
      task.goNextPending();
      return;
    }

    if (!task.sessionData?.task) {
      setSubmitMessage('缺少当前任务，无法提交。');
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      await task.saveCurrentQuantityNow();
      await (task.sessionData.task.status === 'submitted'
        ? task.sessionData.task
        : await task.submitCurrentTask({
          notify_admin: true,
          submit_source: 'task_page',
          submit_version: 'role-split-phase',
        }));
      setSubmitMessage('已提交。管理员账号会在消息中心看到本次记录。');
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : '提交失败，请重试。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`min-h-screen bg-slate-50 ${compact ? 'px-2.5 py-2' : 'px-4 py-4'}`}>
      <div className={`mx-auto flex max-w-5xl flex-col ${compact ? 'gap-2.5' : 'gap-4'}`}>
        <header className={`rounded-2xl bg-white shadow-sm ${compact ? 'p-2.5' : 'p-4'}`}>
          <div className="flex items-start justify-between gap-4">
            <button aria-label="返回" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" onClick={() => navigate('/app/workbench', { replace: true })} type="button"><ArrowLeft className="h-5 w-5" /></button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-500">{auth.store?.name ?? '当前门店'}</p>
              <h1 className={`${compact ? 'text-lg' : 'mt-1 text-xl'} font-bold text-slate-900`}>{text.title}</h1>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
              {task.stats.processed}/{task.stats.total}
            </div>
          </div>
          <div className={`${compact ? 'mt-2 h-1.5' : 'mt-3 h-2'} rounded-full bg-slate-100`}>
            <div className="h-2 rounded-full bg-brand-600 transition-all" style={progressStyle} />
          </div>
          <div className={`${compact ? 'mt-2' : 'mt-3'} flex items-center justify-between text-xs text-slate-500`}>
            <span>{text.modeLabel}进度 {task.stats.percent}%</span>
            {mode === 'inventory' ? (
              <button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700" onClick={() => void openInventoryImport()} type="button">
                <FileDown className="h-4 w-4" aria-hidden="true" />
                导入历史盘点单
              </button>
            ) : null}
          </div>
        </header>

        {task.status === 'loading' ? (
          <StatePanel title="正在加载" body="正在加载门店货品和未完成草稿。" />
        ) : null}

        {task.status === 'error' || task.status === 'empty' ? (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm leading-6 text-red-700">{task.message}</p>
            <button
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white"
              onClick={() => void task.loadOrCreate(false)}
              type="button"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              重试
            </button>
          </div>
        ) : null}

        {task.status === 'ready' && showSummary ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-14 w-14 text-brand-600" aria-hidden="true" />
            <p className="mt-4 text-sm font-semibold text-brand-700">{text.summaryTitle}</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">
              {mode === 'inventory' && task.stats.pending > 0
                ? `还有 ${task.stats.pending} 项未盘点，可以直接提交或返回继续盘点。`
                : text.summaryBody}
            </h2>
            <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
              <SummaryStat label="总数" value={task.stats.total} />
              <SummaryStat label={mode === 'inventory' ? '已盘点' : '已处理'} value={task.stats.processed} />
              <SummaryStat label={mode === 'inventory' ? '未盘点' : '未处理'} value={task.stats.pending} />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button className="min-h-12 rounded-xl border border-slate-200 px-4 font-semibold" onClick={() => setShowSummary(false)} type="button">
                返回修改
              </button>
              <button className="min-h-12 rounded-xl border border-slate-200 px-4 font-semibold" onClick={() => setShowExtraForm(true)} type="button">
                继续新增货品
              </button>
              <button className="min-h-12 rounded-xl bg-brand-600 px-4 font-semibold text-white disabled:bg-slate-300" disabled={isSubmitting} onClick={() => void submitTaskOnly()} type="button">
                {isSubmitting ? '正在提交' : `提交本次${text.modeLabel}`}
              </button>
            </div>
            {submitMessage ? <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{submitMessage}</p> : null}
          </div>
        ) : null}

        {task.status === 'ready' && !showSummary ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:hidden">
              <button className="min-h-12 rounded-xl bg-white px-4 font-bold text-slate-800 shadow-sm" onClick={() => setShowProcessedDrawer(true)} type="button">
                {text.processedLabel} {task.stats.processed}
              </button>
              <button className="min-h-12 rounded-xl bg-white px-4 font-bold text-slate-800 shadow-sm" onClick={() => setShowPendingDrawer(true)} type="button">
                {text.pendingLabel} {task.stats.pending}
              </button>
            </div>

            <div className={`grid lg:grid-cols-[230px_1fr_230px] ${compact ? 'gap-2.5' : 'gap-4'}`}>
              <aside className="hidden rounded-2xl bg-white p-4 shadow-sm lg:block">
                <h2 className="font-semibold text-slate-900">{text.processedLabel}列表</h2>
                <ItemList currentId={task.currentItem?.id} items={task.processedItems} onSelect={task.goToIndex} sourceItems={task.items} />
              </aside>

              <section className={`rounded-2xl bg-white shadow-sm ${compact ? 'p-3.5' : 'p-5'}`}>
                {task.message ? (
                  <p className="mb-4 rounded-xl bg-accent-50 p-3 text-sm leading-6 text-accent-700">{task.message}</p>
                ) : null}

                <div className="flex items-center justify-between text-sm font-semibold text-slate-500">
                  <span>当前货品</span>
                  <span>{task.stats.total ? task.currentIndex + 1 : 0}/{task.stats.total}</span>
                </div>

                <div className={`${compact ? 'mt-2 min-h-20' : 'mt-6 min-h-36'} text-center`}>
                  <h2 className={`${compact ? 'text-2xl' : 'text-3xl'} font-bold leading-tight text-slate-900`}>{snapshot?.name ?? '暂无货品'}</h2>
                  <p className={`${compact ? 'mt-1.5 text-sm' : 'mt-3 text-base'} text-slate-500`}>{snapshot?.spec || '无规格'}</p>
                  {task.currentItem?.status === 'no_order_needed' ? (
                    <span className="mt-4 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">已标记无需订货</span>
                  ) : null}
                  {task.currentItem?.product_action_status === 'deletion_requested' ? (
                    <span className="mt-4 inline-flex rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">申请删除</span>
                  ) : null}
                  {task.currentItem?.product_action_status === 'deletion_approved' ? (
                    <span className="mt-4 inline-flex rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">已确认删除</span>
                  ) : null}
                </div>

                <div className={`${compact ? 'mt-2.5 gap-2' : 'mt-5 gap-3'} flex items-center justify-center`}>
                  <button
                    aria-label="减少数量"
                    className={`flex items-center justify-center rounded-2xl bg-slate-100 text-slate-700 active:scale-95 disabled:text-slate-300 ${compact ? 'h-12 w-12' : 'h-14 w-14'}`}
                    disabled={deletionActionLocked}
                    onClick={() => updateQuantity(-1)}
                    type="button"
                  >
                    <ChevronDown className="h-7 w-7" aria-hidden="true" />
                  </button>
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{text.quantityLabel}</span>
                    <input
                      className={`${compact ? 'h-16 text-4xl' : 'h-24 text-5xl'} w-full rounded-2xl border-2 border-slate-200 bg-slate-50 text-center font-bold text-slate-900 outline-none transition focus:border-brand-500 focus:bg-white`}
                      disabled={deletionActionLocked}
                      inputMode="decimal"
                      min="0"
                      onChange={(event) => task.setQuantityInput(event.target.value)}
                      placeholder="0"
                      type="number"
                      value={task.quantityInput}
                    />
                  </label>
                  <button
                    aria-label="增加数量"
                    className={`flex items-center justify-center rounded-2xl bg-slate-100 text-slate-700 active:scale-95 disabled:text-slate-300 ${compact ? 'h-12 w-12' : 'h-14 w-14'}`}
                    disabled={deletionActionLocked}
                    onClick={() => updateQuantity(1)}
                    type="button"
                  >
                    <ChevronUp className="h-7 w-7" aria-hidden="true" />
                  </button>
                </div>
                <p className={`${compact ? 'mt-1.5' : 'mt-3'} text-center text-sm font-semibold text-slate-500`}>{snapshot?.count_unit || '单位'}</p>

                <div className={`${compact ? 'mt-3 gap-2' : 'mt-6 gap-3'} grid grid-cols-2`}>
                  <button
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-slate-700 disabled:text-slate-300"
                    disabled={!canGoPrevious}
                    onClick={() => task.setCurrentIndex((current) => Math.max(0, current - 1))}
                    type="button"
                  >
                    <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                    上一个
                  </button>
                  <button
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-slate-700 disabled:text-slate-300"
                    disabled={!canGoNext}
                    onClick={() => task.setCurrentIndex((current) => Math.min(task.items.length - 1, current + 1))}
                    type="button"
                  >
                    下一个
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <button className={`${compact ? 'mt-2 min-h-10 text-sm' : 'mt-3 min-h-12'} w-full rounded-xl bg-slate-900 px-4 font-bold text-white active:scale-[0.99]`} onClick={task.goNextPending} type="button">
                  下一项未处理
                </button>

                {mode === 'order' ? (
                  <button className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 font-bold text-slate-700" onClick={() => void task.markNoOrderNeeded()} type="button">
                    <Ban className="h-5 w-5" aria-hidden="true" />
                    无需订货
                  </button>
                ) : null}

                {task.currentItem?.product_id ? (
                  <div className={`${compact ? 'mt-3 p-3' : 'mt-5 p-4'} rounded-2xl bg-slate-50`}>
                    {feedbackActionMessage ? (
                      <p className="mt-3 rounded-xl bg-white p-3 text-sm leading-6 text-slate-700">{feedbackActionMessage}</p>
                    ) : null}
                    {deletionRequested ? (
                      <p className="mt-3 rounded-xl bg-accent-50 p-3 text-sm font-semibold leading-6 text-accent-700">
                        已提交删除此货品，等待管理员确认。
                      </p>
                    ) : null}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-700 disabled:text-slate-300"
                        disabled={feedbackBusy || deletionActionLocked}
                        onClick={() => { if (!canRequestProductDeletion) { setFeedbackActionMessage('当前账号没有货品删除权限，请联系管理员授权。'); return; } setShowDeletionConfirm(true); }}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        不再使用
                      </button>
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-700 disabled:text-slate-300"
                        disabled={feedbackBusy || !task.currentItem?.product_id}
                        onClick={() => { if (!canCorrectProduct) { setFeedbackActionMessage('当前账号没有货品修订权限，请联系管理员授权。'); return; } openCorrectionForm(); }}
                        type="button"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        信息有误
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className={`${compact ? 'mt-3 gap-2' : 'mt-5 gap-3'} grid grid-cols-[minmax(0,1.6fr)_minmax(8.5rem,1fr)]`}>
                  <button className={`${compact ? 'min-h-12 text-base' : 'min-h-16 text-lg'} rounded-xl bg-brand-600 px-5 font-bold text-white shadow-lg shadow-brand-100 active:scale-[0.99]`} onClick={finishTask} type="button">
                    {text.complete}
                  </button>
                  {isManager || productPermissions.new ? <button
                    className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 font-bold text-slate-800 ${compact ? 'min-h-12 text-sm' : 'min-h-16'}`}
                    onClick={() => {
                      setExtraFormMessage(null);
                      setShowExtraForm(true);
                    }}
                    type="button"
                  >
                    <PackagePlus className="h-5 w-5" aria-hidden="true" />
                    新增货品
                  </button> : null}
                </div>
              </section>

              <aside className="hidden rounded-2xl bg-white p-4 shadow-sm lg:block">
                <h2 className="font-semibold text-slate-900">{text.pendingLabel}列表</h2>
                <ItemList currentId={task.currentItem?.id} items={task.pendingItems} onSelect={task.goToIndex} sourceItems={task.items} />
              </aside>
            </div>
          </>
        ) : null}
      </div>

      <TaskDrawer
        currentId={task.currentItem?.id}
        items={task.processedItems}
        onClose={() => setShowProcessedDrawer(false)}
        onSelect={task.goToIndex}
        open={showProcessedDrawer}
        sourceItems={task.items}
        title={`${text.processedLabel}列表`}
      />
      <TaskDrawer
        currentId={task.currentItem?.id}
        items={task.pendingItems}
        onClose={() => setShowPendingDrawer(false)}
        onSelect={task.goToIndex}
        open={showPendingDrawer}
        sourceItems={task.items}
        title={`${text.pendingLabel}列表`}
      />

      {showInventoryImport ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="inventory-import-title">
          <div className="ui-dialog-panel flex max-w-2xl flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileDown className="h-5 w-5 text-brand-600" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-slate-900" id="inventory-import-title">导入历史盘点单</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">显示本门店所有账号提交的盘点单。导入会覆盖当前草稿中匹配货品的盘点状态和数量。</p>
              </div>
              <button aria-label="关闭导入历史盘点单" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100" onClick={() => setShowInventoryImport(false)} type="button">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {inventoryImportStatus === 'loading' ? <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">正在加载历史盘点单</p> : null}
            {inventoryImportMessage ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-700">{inventoryImportMessage}</p> : null}
            {inventoryImportStatus !== 'loading' && inventoryTemplates.length === 0 ? (
              <p className="mt-5 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">本门店暂无已提交的盘点单。</p>
            ) : null}

            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
              {inventoryTemplates.map((template) => (
                <article className="rounded-xl border border-slate-200 p-4" key={template.task_id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{template.created_by_name}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-sm text-slate-500">
                        <Clock3 className="h-4 w-4" aria-hidden="true" />
                        {formatTemplateTime(template.submitted_at)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{template.task_id.slice(0, 8)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-slate-500">总数</p><p className="mt-1 font-bold text-slate-900">{template.total_count}</p></div>
                    <div className="rounded-lg bg-brand-50 p-2"><p className="text-xs text-brand-700">已盘点</p><p className="mt-1 font-bold text-brand-700">{template.processed_count}</p></div>
                    <div className="rounded-lg bg-accent-50 p-2"><p className="text-xs text-accent-700">未盘点</p><p className="mt-1 font-bold text-accent-700">{template.pending_count}</p></div>
                  </div>
                  <button className="mt-3 min-h-11 w-full rounded-lg bg-brand-600 px-4 font-bold text-white disabled:bg-slate-300" disabled={inventoryImportStatus === 'importing'} onClick={() => void importInventoryTemplate(template.task_id)} type="button">
                    {inventoryImportStatus === 'importing' ? '正在导入' : '导入并继续盘点'}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showExtraForm ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="extra-product-title">
          <div className="ui-dialog-panel max-w-sm p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-brand-600" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-900" id="extra-product-title">新增货品</h2>
              </div>
              <button aria-label="关闭" className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100" onClick={() => setShowExtraForm(false)} type="button">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mb-4 text-sm leading-6 text-slate-600">
              {isManager ? '保存后会同步新增到本店货品数据库，并通知管理员。' : '本次任务临时新增，不会直接写入货品数据库。'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input className="col-span-2 min-h-11 rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => setExtraForm((current) => ({ ...current, name: event.target.value }))} placeholder="货品名称" value={extraForm.name} />
              <input className="col-span-2 min-h-11 rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => setExtraForm((current) => ({ ...current, spec: event.target.value }))} placeholder="规格" value={extraForm.spec} />
              <input className="min-h-11 rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-500" onChange={(event) => setExtraForm((current) => ({ ...current, countUnit: event.target.value }))} placeholder="单位" value={extraForm.countUnit} />
              <input className="min-h-11 rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-500" inputMode="decimal" onChange={(event) => setExtraForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="数量" type="number" value={extraForm.quantity} />
              <textarea className="col-span-2 min-h-20 rounded-xl border border-slate-200 p-3 outline-none focus:border-brand-500" onChange={(event) => setExtraForm((current) => ({ ...current, note: event.target.value }))} placeholder="备注，可选" value={extraForm.note} />
            </div>
            {extraFormMessage ? <p className="mt-3 rounded-xl bg-accent-50 p-3 text-sm leading-6 text-accent-700">{extraFormMessage}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-12 rounded-xl border border-slate-200 font-semibold" disabled={extraFormBusy} onClick={() => setShowExtraForm(false)} type="button">取消</button>
              <button className="min-h-12 rounded-xl bg-brand-600 font-semibold text-white disabled:bg-slate-300" disabled={extraFormBusy} onClick={() => void submitExtraItem()} type="button">{extraFormBusy ? '正在保存' : '保存货品'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {showCorrectionForm && snapshot ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="product-correction-title">
          <div className="ui-dialog-panel max-w-md p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-brand-600" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-900" id="product-correction-title">更正货品信息</h2>
              </div>
              <button aria-label="关闭更正货品信息" className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100" onClick={() => setShowCorrectionForm(false)} type="button">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p className="mb-4 text-sm leading-6 text-slate-600">提交后立即更新本店货品资料，并向管理员发送一条修改通知。</p>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                货品名称
                <input className="min-h-11 rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" onChange={(event) => setCorrectionForm((current) => ({ ...current, name: event.target.value }))} value={correctionForm.name} />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                规格
                <input className="min-h-11 rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" onChange={(event) => setCorrectionForm((current) => ({ ...current, spec: event.target.value }))} value={correctionForm.spec} />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                单位
                <input className="min-h-11 rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-brand-500" onChange={(event) => setCorrectionForm((current) => ({ ...current, countUnit: event.target.value }))} value={correctionForm.countUnit} />
              </label>
              <textarea className="min-h-20 rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-brand-500" onChange={(event) => setFeedbackNote(event.target.value)} placeholder="修改说明，可选" value={feedbackNote} />
            </div>
            {feedbackActionMessage ? <p className="mt-3 rounded-xl bg-accent-50 p-3 text-sm text-accent-700">{feedbackActionMessage}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-12 rounded-xl border border-slate-200 font-semibold" disabled={feedbackBusy} onClick={() => setShowCorrectionForm(false)} type="button">取消</button>
              <button className="min-h-12 rounded-xl bg-brand-600 font-semibold text-white disabled:bg-slate-300" disabled={feedbackBusy} onClick={() => void submitManagerCorrection()} type="button">
                {feedbackBusy ? '正在提交' : '提交修改'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDeletionConfirm && snapshot ? (
        <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="product-deletion-title">
          <div className="ui-dialog-panel max-w-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-50 p-3 text-red-700"><Trash2 className="h-5 w-5" aria-hidden="true" /></div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900" id="product-deletion-title">确认提交删除申请？</h2>
                <p className="mt-1 text-sm text-slate-600">{snapshot.name} · {snapshot.spec}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">货品不会立即删除。管理员收到通知并再次确认后，才会从货品数据库中删除；历史点货和订货记录仍会保留。</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-12 rounded-xl border border-slate-200 font-semibold" disabled={feedbackBusy} onClick={() => setShowDeletionConfirm(false)} type="button">取消</button>
              <button className="min-h-12 rounded-xl bg-red-700 font-semibold text-white disabled:bg-slate-300" disabled={feedbackBusy} onClick={() => void confirmManagerDeletionRequest()} type="button">
                {feedbackBusy ? '正在提交' : '确认提交申请'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatePanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

interface TaskDrawerProps {
  currentId?: string;
  items: TaskItemRow[];
  onClose: () => void;
  onSelect: (index: number) => void;
  open: boolean;
  sourceItems: TaskItemRow[];
  title: string;
}

function TaskDrawer({ currentId, items, onClose, onSelect, open, sourceItems, title }: TaskDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <div className="safe-bottom absolute inset-y-0 right-0 flex w-80 max-w-[88vw] flex-col bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          </div>
          <button aria-label="关闭列表" className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100" onClick={onClose} type="button">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ItemList currentId={currentId} items={items} onClose={onClose} onSelect={onSelect} sourceItems={sourceItems} />
      </div>
    </div>
  );
}

interface ItemListProps {
  currentId?: string;
  items: TaskItemRow[];
  onClose?: () => void;
  onSelect: (index: number) => void;
  sourceItems: TaskItemRow[];
}

function ItemList({ currentId, items, onClose, onSelect, sourceItems }: ItemListProps) {
  if (items.length === 0) {
    return <p className="mt-3 text-sm leading-6 text-slate-600">暂无货品。</p>;
  }

  return (
    <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
      {items.map((item) => {
        const snapshot = asProductSnapshot(item.product_snapshot);
        const originalIndex = sourceItems.findIndex((source) => source.id === item.id);
        const statusLabel = item.status === 'no_order_needed' ? '无需订货' : item.quantity === null ? snapshot.spec : `${item.quantity} ${snapshot.count_unit}`;
        return (
          <button
            className={[
              'w-full rounded-xl border p-3 text-left text-sm leading-5 transition active:scale-[0.99]',
              item.id === currentId ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white',
            ].join(' ')}
            key={item.id}
            onClick={() => {
              onSelect(originalIndex);
              onClose?.();
            }}
            type="button"
          >
            <span className="flex items-start justify-between gap-2 font-semibold text-slate-900">
              <span>{originalIndex + 1}. {snapshot.name}</span>
              {item.product_action_status === 'deletion_requested' ? (
                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">申请删除</span>
              ) : null}
            </span>
            <span className="mt-1 block text-slate-500">{statusLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
