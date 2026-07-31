import { BookOpenCheck, Camera, ChevronRight, Megaphone, Save, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageShell } from '../components/layout/PageShell';
import { SuccessToast } from '../components/feedback/SuccessToast';
import { MobileActionBar } from '../components/ui/Actions';
import { FeedbackBanner, LoadingState } from '../components/ui/Feedback';
import { useAuth } from '../features/auth/AuthContext';
import { TaskImagePreview } from '../features/v2-tasks/TaskImagePreview';
import { TaskReferenceImagePreview } from '../features/v2-tasks/TaskReferenceImagePreview';
import { getTaskSubmissionIssues, type TaskSubmissionIssue } from '../features/v2-tasks/taskCompletion';
import { v2TaskStatusClass, v2TaskStatusLabel } from '../features/v2-tasks/taskPresentation';
import { supabase } from '../lib/supabase';
import type { Json } from '../types/database';
import { asTaskItemSnapshot, deleteV2TaskImage, getV2TaskAnswerPositions, loadV2TaskDetail, loadV2TaskImageUrls, loadV2TaskReferenceImageUrls, saveV2TaskProgress, submitV2Task, uploadV2TaskImage, type V2TaskAnswerRow, type V2TaskDetail, type V2TaskImageRow } from '../services/v2-tasks.service';

export function V2TaskExecutionPage() {
  const { taskId = '' } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<V2TaskDetail | null>(null);
  const [answers, setAnswers] = useState<V2TaskAnswerRow[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [referenceImageUrls, setReferenceImageUrls] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submissionIssues, setSubmissionIssues] = useState<TaskSubmissionIssue[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [deletingImageIds, setDeletingImageIds] = useState<string[]>([]);
  const dirty = useRef(false);
  const activeUploads = useRef(new Set<Promise<void>>());
  const uploadedImages = useRef(new Map<string, string>());
  const contentSignature = useRef('');

  const taskContentSignature = (task: Pick<V2TaskDetail['task'], 'due_at' | 'name' | 'related_content_title' | 'related_notice_id' | 'related_sop_id' | 'snapshot'>) => JSON.stringify([task.name, task.due_at, task.related_sop_id, task.related_notice_id, task.related_content_title, task.snapshot]);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const next = await loadV2TaskDetail(supabase, taskId);
      contentSignature.current = taskContentSignature(next.task);
      setDetail(next);
      uploadedImages.current = new Map(next.images.map((image) => [image.id, image.item_id]));
      setAnswers(next.answers);
      setImageUrls(await loadV2TaskImageUrls(supabase, next.images));
      setReferenceImageUrls(await loadV2TaskReferenceImageUrls(supabase, next.answers));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载任务失败');
    }
  }, [taskId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!supabase || !taskId) return;
    const client = supabase;
    if (typeof client.channel !== 'function') return;
    let timer = 0;
    const refresh = (payload: { new?: Record<string, unknown> }) => {
      const next = payload.new;
      if (!next || typeof next.name !== 'string' || typeof next.due_at !== 'string' || !('snapshot' in next)) return;
      const signature = JSON.stringify([next.name, next.due_at, next.related_sop_id, next.related_notice_id, next.related_content_title, next.snapshot]);
      if (signature === contentSignature.current) return;
      contentSignature.current = signature;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load().then(() => setSuccessMessage('管理员已更新任务内容，当前页面已同步'));
      }, 180);
    };
    const channel = client.channel(`v2-task-live-${taskId}`)
      .on('postgres_changes', { event: 'UPDATE', filter: `id=eq.${taskId}`, schema: 'public', table: 'v2_tasks' }, (payload) => refresh(payload as unknown as { new?: Record<string, unknown> }))
      .subscribe();
    return () => { window.clearTimeout(timer); void client.removeChannel(channel); };
  }, [load, taskId]);

  const editable = detail ? ['pending', 'in_progress', 'rejected', 'overdue'].includes(detail.task.status) : false;
  const answerPositions = useMemo(() => getV2TaskAnswerPositions(detail?.task.snapshot ?? null), [detail?.task.snapshot]);
  const progress = useMemo(() => answers.length ? Math.round(answers.filter((answer) => answer.answer !== null).length / answers.length * 100) : 0, [answers]);
  const currentSubmissionIssues = useMemo(() => getTaskSubmissionIssues(
    answers,
    (detail?.images ?? []).filter((image) => !image.id.startsWith('local-')).map((image) => image.item_id),
  ), [answers, detail?.images]);
  const update = (id: string, answer: Json) => { dirty.current = true; setAnswers((current) => current.map((entry) => entry.item_id === id ? { ...entry, answer } : entry)); };
  const save = async (manual = false) => {
    if (!supabase || !detail) return detail?.task;
    if (!dirty.current) { if (manual) setSuccessMessage('任务已保存'); return detail.task; }
    setBusy(true);
    try {
      const task = await saveV2TaskProgress(supabase, detail.task.id, detail.task.version, answers);
      dirty.current = false;
      setDetail({ ...detail, task });
      if (manual) setSuccessMessage('任务已保存'); else setMessage('已自动保存');
      return task;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally { setBusy(false); }
  };
  // The timer is intentionally restarted only when answer data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!editable || !dirty.current) return; const timer = setTimeout(() => void save(), 800); return () => clearTimeout(timer); }, [answers, editable]);
  const submit = async () => {
    if (!supabase || !detail) return;
    setBusy(true);
    if (activeUploads.current.size > 0) {
      setMessage('正在完成图片上传，请稍候…');
      await Promise.all([...activeUploads.current]);
    }
    let validationImages = detail.images.filter((image) => !image.id.startsWith('local-'));
    let refreshedImages = false;
    try {
      const latest = await loadV2TaskDetail(supabase, detail.task.id);
      validationImages = latest.images;
      refreshedImages = true;
      setDetail((current) => current ? { ...current, images: latest.images } : current);
      latest.images.forEach((image) => uploadedImages.current.set(image.id, image.item_id));
    } catch {
      // The upload callback also records successful item ids synchronously, so a
      // transient detail refresh failure must not force the user to reload the page.
    }
    const availableImageItemIds = refreshedImages
      ? validationImages.map((image) => image.item_id)
      : [...uploadedImages.current.values()];
    const issues = getTaskSubmissionIssues(answers, availableImageItemIds);
    if (issues.length > 0) { setSubmissionIssues(issues); setBusy(false); return; }
    try {
      const saved = await save();
      await submitV2Task(supabase, detail.task.id, saved?.version ?? detail.task.version);
      window.dispatchEvent(new Event('storehub:todos-changed'));
      setSuccessMessage('任务已提交，等待管理员审核');
    } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败'); }
    finally { setBusy(false); }
  };
  const upload = async (itemId: string, file: File | undefined) => {
    if (!file || !supabase || !detail || !auth.profile) return;
    const localPreviewUrl = URL.createObjectURL(file);
    const temporaryImage = { bucket: 'v2-task-images', created_at: new Date().toISOString(), file_name: file.name || 'uploading-image', id: `local-${Date.now()}-${Math.random()}`, item_id: itemId, mime_type: file.type, object_path: '', size_bytes: file.size, store_id: detail.task.store_id, task_id: detail.task.id, uploaded_by: auth.profile.id, upload_progress: 5 } as V2TaskImageRow;
    setDetail((current) => current ? { ...current, images: [...current.images, temporaryImage] } : current);
    setImageUrls((current) => ({ ...current, [temporaryImage.id]: localPreviewUrl }));
    setBusy(true);
    try {
      const uploaded = await uploadV2TaskImage(supabase, detail.task, itemId, auth.profile.id, file, (nextProgress) => setDetail((current) => current ? { ...current, images: current.images.map((image) => image.id === temporaryImage.id ? { ...image, upload_progress: nextProgress } as V2TaskImageRow : image) } : current));
      uploadedImages.current.set(uploaded.id, itemId);
      setDetail((current) => current ? {
        ...current,
        images: current.images.map((image) => image.id === temporaryImage.id ? uploaded : image),
      } : current);
      const persistedUrl = (await loadV2TaskImageUrls(supabase, [uploaded]))[uploaded.id] ?? localPreviewUrl;
      if (persistedUrl !== localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setImageUrls((current) => { const next = { ...current }; delete next[temporaryImage.id]; return { ...next, [uploaded.id]: persistedUrl }; });
      setMessage(null);
    }
    catch (error) { setDetail((current) => current ? { ...current, images: current.images.filter((image) => image.id !== temporaryImage.id) } : current); setImageUrls((current) => { const next = { ...current }; delete next[temporaryImage.id]; return next; }); setMessage(error instanceof Error ? error.message : '图片上传失败'); }
    finally { setBusy(false); }
  };
  const queueUpload = (itemId: string, file: File | undefined) => {
    if (!file) return;
    const request = upload(itemId, file);
    activeUploads.current.add(request);
    setActiveUploadCount((current) => current + 1);
    void request.finally(() => {
      activeUploads.current.delete(request);
      setActiveUploadCount((current) => Math.max(0, current - 1));
    });
  };
  const deleteImage = async (image: V2TaskImageRow) => {
    if (!supabase || !detail || image.id.startsWith('local-')) return;
    if (!window.confirm('确认删除这张任务图片吗？删除后可以重新上传。')) return;
    setDeletingImageIds((current) => [...current, image.id]);
    try {
      const result = await deleteV2TaskImage(supabase, image);
      setDetail((current) => {
        if (!current) return current;
        const images = current.images.filter((entry) => entry.id !== image.id);
        uploadedImages.current.delete(image.id);
        return { ...current, images };
      });
      setImageUrls((current) => {
        const next = { ...current };
        const removedUrl = next[image.id];
        if (removedUrl?.startsWith('blob:')) URL.revokeObjectURL(removedUrl);
        delete next[image.id];
        return next;
      });
      setSuccessMessage(result.storageCleanupFailed ? '图片已删除，存储清理将由管理员后续处理' : '图片已删除，可以重新上传');
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除图片失败');
    } finally {
      setDeletingImageIds((current) => current.filter((id) => id !== image.id));
    }
  };

  return <PageShell eyebrow="门店运营系统 · 任务执行" title={detail?.task.name ?? '任务'} backTo="/app/tasks" contentGapClassName="gap-3">
    {detail ? <><section className="ui-card p-4"><div className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">截止：{new Date(detail.task.due_at).toLocaleString('zh-CN')}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${v2TaskStatusClass[detail.task.status]}`}>{v2TaskStatusLabel[detail.task.status]}</span></div><div className="mt-3 flex justify-between text-sm"><span className="text-slate-600">填写进度</span><b className="tabular-nums">{progress}%</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div>{detail.task.status === 'rejected' ? <FeedbackBanner className="mt-3" title="任务已退回整改" tone="danger"><p>整改原因：{detail.task.review_note?.trim() || '管理员未填写原因，请联系管理员确认。'}</p><p>请优先修改标有“需整改”的项目后重新提交。</p></FeedbackBanner> : null}</section>
    {detail.task.related_sop_id || detail.task.related_notice_id ? <Link className="ui-card flex items-center gap-3 border-brand-100 bg-brand-50 p-3 transition active:scale-[0.99]" state={{ taskBackTo: `/app/tasks/${detail.task.id}` }} to={detail.task.related_sop_id ? `/app/sops/${detail.task.related_sop_id}` : `/app/notices/${detail.task.related_notice_id}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700">{detail.task.related_sop_id ? <BookOpenCheck className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}</span>
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-brand-700">{detail.task.related_sop_id ? '任务关联 SOP' : '任务关联公告'}</span><b className="mt-0.5 block truncate text-slate-900">{detail.task.related_content_title ?? (detail.task.related_sop_id ? '查看操作标准' : '查看公告内容')}</b></span>
      <span className="inline-flex shrink-0 items-center text-sm font-bold text-brand-700">查看<ChevronRight className="h-4 w-4" /></span>
    </Link> : null}
    {message ? <FeedbackBanner tone="warning">{message}</FeedbackBanner> : null}
    <div className="space-y-3">{answers.map((answer, index) => {
      const position = answerPositions[answer.item_id] ?? { groupNumber: 1, groupTitle: '任务项目', itemNumber: index + 1, number: `${index + 1}` };
      const previous = index > 0 ? answerPositions[answers[index - 1].item_id] : null;
      const showGroup = index === 0 || previous?.groupNumber !== position.groupNumber;
      const needsCorrection = detail.task.status === 'rejected' && detail.task.correction_item_ids.includes(answer.item_id);
      const itemEditable = editable && (detail.task.status !== 'rejected' || needsCorrection);
      return <div key={answer.id}>{showGroup ? <div className="mb-2 flex items-center gap-2 px-1"><span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-bold text-white">分组 {position.groupNumber}</span><h2 className="font-bold text-slate-800">{position.groupTitle}</h2></div> : null}<AnswerCard answer={answer} deletingImageIds={deletingImageIds} editable={itemEditable} imageUrls={imageUrls} images={detail.images.filter((image) => image.item_id === answer.item_id)} needsCorrection={needsCorrection} number={position.number} onChange={(value) => update(answer.item_id, value)} onDeleteImage={deleteImage} onUpload={(file) => queueUpload(answer.item_id, file)} referenceImageUrls={referenceImageUrls[answer.item_id] ?? []} uploaderId={auth.profile?.id ?? ''} /></div>;
    })}</div>
    {editable ? <MobileActionBar className="grid grid-cols-2 gap-2.5"><button className="ui-button-secondary" disabled={busy || activeUploadCount > 0} onClick={() => void save(true)} type="button"><Save className="h-5 w-5" />保存</button><button className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg font-bold disabled:opacity-60 ${currentSubmissionIssues.length > 0 ? 'bg-slate-300 text-slate-600' : 'bg-brand-600 text-white'}`} disabled={busy || activeUploadCount > 0} onClick={() => void submit()} type="button"><Send className="h-5 w-5" />{activeUploadCount > 0 ? '图片上传中…' : '提交检查'}</button></MobileActionBar> : null}</> : <LoadingState label="正在加载任务" />}
    {submissionIssues.length > 0 ? <div className="ui-dialog-overlay" role="dialog" aria-modal="true" aria-label="必填项目未完成"><section className="ui-dialog-panel max-w-sm p-5"><h2 className="text-lg font-bold text-slate-900">请先完成必填项目</h2><p className="mt-2 text-sm leading-6 text-slate-600">以下内容尚未完成，完成后才能提交检查：</p><ul className="mt-3 space-y-2">{submissionIssues.map((issue) => <li className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm" key={issue.itemId}><b className="block text-slate-900">项目：{issue.label}</b><span className="mt-1 block text-amber-800">{issue.reason}</span></li>)}</ul><button className="ui-button-primary mt-5 w-full" onClick={() => setSubmissionIssues([])} type="button">我知道了</button></section></div> : null}
    <SuccessToast message={successMessage} onClose={() => { const returnToTasks = successMessage === '任务已提交，等待管理员审核'; setSuccessMessage(null); if (returnToTasks) navigate('/app/tasks'); }} />
  </PageShell>;
}

function AnswerCard({ answer, deletingImageIds, editable, images, imageUrls, needsCorrection, number, onChange, onDeleteImage, onUpload, referenceImageUrls, uploaderId }: { answer: V2TaskAnswerRow; deletingImageIds: string[]; editable: boolean; images: V2TaskImageRow[]; imageUrls: Record<string, string>; needsCorrection: boolean; number: string; onChange: (value: Json) => void; onDeleteImage: (image: V2TaskImageRow) => void; onUpload: (file: File | undefined) => void; referenceImageUrls: string[]; uploaderId: string }) {
  const item = asTaskItemSnapshot(answer.item_snapshot);
  const options = Array.isArray(item.options) ? item.options.filter((value): value is string => typeof value === 'string') : [];
  const value = answer.answer;
  const expectsImages = ['image', 'multi_image'].includes(item.field_type) || item.image_requirement !== 'none';
  const canUpload = editable;
  const requiredImageCount = item.image_requirement === 'multiple' && typeof item.minimum_image_count === 'number'
    ? Math.max(2, Math.min(20, item.minimum_image_count))
    : 1;
  const uploadedImageCount = images.filter((image) => !image.id.startsWith('local-')).length;
  return <article className={`ui-card p-4 ${needsCorrection ? 'border-red-300 bg-red-50/20' : !editable && answer.review_status === 'approved' ? 'border-emerald-200 bg-emerald-50/20' : ''}`}><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{number}</span><h2 className="font-bold">{item.label}{item.is_required ? <span className="ml-1 text-red-600">*</span> : ''}</h2>{needsCorrection ? <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700">需整改</span> : !editable && answer.review_status === 'approved' ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">已通过 · 无需修改</span> : null}</div>{item.guidance ? <p className="mt-1 text-sm leading-5 text-slate-500">{item.guidance}</p> : null}<TaskReferenceImagePreview urls={referenceImageUrls} /><div className="mt-3">
    {item.field_type === 'instruction' ? <p className="rounded bg-slate-50 p-3 text-sm">请按说明完成本项。</p> : null}
    {['short_text', 'long_text'].includes(item.field_type) ? <textarea className="ui-input min-h-20 py-3" disabled={!editable} onChange={(event) => onChange(event.target.value)} value={typeof value === 'string' ? value : ''} /> : null}
    {['integer', 'decimal', 'rating'].includes(item.field_type) ? <input className="ui-input" disabled={!editable} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} type="number" value={typeof value === 'number' ? value : ''} /> : null}
    {['boolean', 'confirmation'].includes(item.field_type) ? <label className="flex min-h-12 items-center gap-3"><input checked={value === true} disabled={!editable} onChange={(event) => onChange(event.target.checked)} type="checkbox" />确认完成</label> : null}
    {item.field_type === 'single_choice' ? <select className="ui-input" disabled={!editable} onChange={(event) => onChange(event.target.value)} value={typeof value === 'string' ? value : ''}><option value="">请选择</option>{options.map((option) => <option key={option}>{option}</option>)}</select> : null}
    {item.field_type === 'multi_choice' ? <div>{options.map((option) => <label className="mr-4 inline-flex gap-2" key={option}><input checked={Array.isArray(value) && value.includes(option)} disabled={!editable} onChange={(event) => { const selected = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []; onChange(event.target.checked ? [...selected, option] : selected.filter((entry) => entry !== option)); }} type="checkbox" />{option}</label>)}</div> : null}
    {expectsImages ? <div className="space-y-3">{item.is_required ? <div className={`rounded-lg border px-3 py-2 text-sm ${uploadedImageCount >= requiredImageCount ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><b>图片要求：至少上传 {requiredImageCount} 张</b><span className="ml-2 text-xs">已完成 {uploadedImageCount}/{requiredImageCount}</span></div> : null}<label className="ui-button-secondary"><Camera className="h-4 w-4" />{images.length ? `继续上传（已选择 ${images.length} 张）` : '上传图片'}<input accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" disabled={!canUpload} onChange={(event) => { onUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} type="file" /></label><TaskImagePreview deletableImageIds={images.filter((image) => image.uploaded_by === uploaderId).map((image) => image.id)} deletingImageIds={deletingImageIds} imageUrls={imageUrls} images={images} onDelete={editable ? onDeleteImage : undefined} /></div> : null}
  </div></article>;
}
