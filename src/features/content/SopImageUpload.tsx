import { ImagePlus, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { createUuid } from '../../lib/uuid';

interface PendingSopImage {
  error: string | null;
  file: File;
  id: string;
  insertAt: number;
  previewUrl: string;
  progress: number;
  status: 'uploading' | 'error';
}

export interface SopImageUploadStatus {
  hasErrors: boolean;
  isUploading: boolean;
}

const revokePreviewUrl = (url: string) => {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
};

export function SopImageUpload({
  disabled,
  onStatusChange,
  onUpload,
  stepCount,
}: {
  disabled: boolean;
  onStatusChange: (status: SopImageUploadStatus) => void;
  onUpload: (file: File, insertAt: number, onProgress: (progress: number) => void) => Promise<void>;
  stepCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingSopImage[]>([]);
  const [pending, setPending] = useState<PendingSopImage[]>([]);
  const [insertPosition, setInsertPosition] = useState<'end' | number>('end');

  useEffect(() => {
    pendingRef.current = pending;
    onStatusChange({
      hasErrors: pending.some((entry) => entry.status === 'error'),
      isUploading: pending.some((entry) => entry.status === 'uploading'),
    });
  }, [onStatusChange, pending]);

  useEffect(() => () => {
    pendingRef.current.forEach((entry) => revokePreviewUrl(entry.previewUrl));
  }, []);

  const runUpload = async (entry: PendingSopImage) => {
    setPending((current) => current.map((item) => item.id === entry.id
      ? { ...item, error: null, progress: 5, status: 'uploading' }
      : item));
    try {
      await onUpload(entry.file, entry.insertAt, (progress) => {
        setPending((current) => current.map((item) => item.id === entry.id ? { ...item, progress } : item));
      });
      revokePreviewUrl(entry.previewUrl);
      setPending((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) {
      setPending((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        error: error instanceof Error ? error.message : 'SOP 图片上传失败，请重试。',
        status: 'error',
      } : item));
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const firstPosition = insertPosition === 'end' ? stepCount : Math.min(insertPosition, stepCount);
    const entries = Array.from(files).map((file, index): PendingSopImage => ({
      error: null,
      file,
      id: `local-${createUuid()}`,
      insertAt: firstPosition + index,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: 'uploading',
    }));
    setPending((current) => [...current, ...entries]);
    // Saving a new SOP creates its durable draft id. Serialize multi-select
    // uploads so those draft writes and step-order calculations cannot race.
    void (async () => {
      for (const entry of entries) await runUpload(entry);
    })();
  };

  const discard = (entry: PendingSopImage) => {
    revokePreviewUrl(entry.previewUrl);
    setPending((current) => current.filter((item) => item.id !== entry.id));
  };

  return <div className="mt-3">
    <input
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      multiple
      onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }}
      ref={inputRef}
      type="file"
    />
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
      <label className="text-xs font-bold text-slate-600">插入位置
        <select aria-label="新图片插入位置" className="ui-input mt-1 min-h-12 py-2 text-sm" disabled={disabled} onChange={(event) => setInsertPosition(event.target.value === 'end' ? 'end' : Number(event.target.value))} value={insertPosition}>
          <option value="end">末尾</option>
          {Array.from({ length: stepCount }, (_, index) => <option key={index} value={index}>插入为第 {index + 1} 步</option>)}
        </select>
      </label>
      <button
        className="flex min-h-16 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/40 px-3 text-center text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <ImagePlus className="h-6 w-6 shrink-0" aria-hidden="true" />
        <span><span className="block font-bold">选择制作图片</span><span className="mt-0.5 block text-[11px] text-slate-500">多选后按选择顺序插入</span></span>
      </button>
    </div>

    {pending.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2">{pending.map((entry) => <div className="overflow-hidden rounded-xl border border-brand-200 bg-white" key={entry.id}>
      <img alt={entry.file.name} className="aspect-[4/3] w-full bg-slate-50 object-cover" src={entry.previewUrl} />
      <div className="p-2">
        <p className="mb-1 text-[11px] font-bold text-brand-700">准备插入第 {entry.insertAt + 1} 步</p>
        {entry.status === 'uploading' ? <>
          <p className="flex items-center gap-1 text-xs font-semibold text-slate-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在上传 {entry.progress}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand-600" style={{ width: `${entry.progress}%` }} /></div>
        </> : <>
          <p className="text-xs leading-5 text-red-700">{entry.error}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md bg-red-50 text-sm font-bold text-red-700" onClick={() => void runUpload(entry)} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" />重试</button>
            <button className="min-h-10 rounded-md bg-slate-100 text-sm font-bold text-slate-700" onClick={() => discard(entry)} type="button">移除</button>
          </div>
        </>}
      </div>
    </div>)}</div> : null}
  </div>;
}
