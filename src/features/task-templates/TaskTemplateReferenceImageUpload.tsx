import { ImagePlus, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { createUuid } from '../../lib/uuid';

interface PendingReferenceImage {
  error: string | null;
  file: File;
  id: string;
  previewUrl: string;
  progress: number;
  status: 'uploading' | 'error';
}

export function TaskTemplateReferenceImageUpload({
  disabled,
  multiple = true,
  onUpload,
}: {
  disabled: boolean;
  multiple?: boolean;
  onUpload: (file: File, onProgress: (progress: number) => void) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingReferenceImage[]>([]);
  const [pending, setPending] = useState<PendingReferenceImage[]>([]);

  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => {
    pendingRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
  }, []);

  const runUpload = async (entry: PendingReferenceImage) => {
    setPending((current) => current.map((item) => item.id === entry.id
      ? { ...item, error: null, progress: 5, status: 'uploading' }
      : item));
    try {
      await onUpload(entry.file, (progress) => {
        setPending((current) => current.map((item) => item.id === entry.id ? { ...item, progress } : item));
      });
      URL.revokeObjectURL(entry.previewUrl);
      setPending((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) {
      setPending((current) => current.map((item) => item.id === entry.id ? {
        ...item,
        error: error instanceof Error ? error.message : '参考图片上传失败，请重试。',
        status: 'error',
      } : item));
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const entries = Array.from(files).map((file): PendingReferenceImage => ({
        error: null,
        file,
        id: createUuid(),
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        status: 'uploading',
    }));
    setPending((current) => [...current, ...entries]);
    // Each upload saves the latest template snapshot before attaching its image.
    // Serialize a multi-select batch so those snapshot writes cannot race.
    void (async () => {
      for (const entry of entries) await runUpload(entry);
    })();
  };

  const discard = (entry: PendingReferenceImage) => {
    URL.revokeObjectURL(entry.previewUrl);
    setPending((current) => current.filter((item) => item.id !== entry.id));
  };

  return <div>
    <input accept="image/jpeg,image/png,image/webp" className="hidden" multiple={multiple} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} ref={inputRef} type="file" />
    <button className="inline-flex min-h-10 items-center gap-1 rounded-lg border bg-white px-3 text-sm font-bold text-brand-700 disabled:opacity-50" disabled={disabled} onClick={() => inputRef.current?.click()} type="button"><ImagePlus className="h-4 w-4" />上传</button>
    {pending.length > 0 ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{pending.map((entry) => <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" key={entry.id}>
      <img alt="本地参考图待上传预览" className="aspect-square w-full object-cover" src={entry.previewUrl} />
      <div className="p-2">{entry.status === 'uploading' ? <><p className="flex items-center gap-1 text-xs font-semibold text-slate-700"><Loader2 className="h-4 w-4 animate-spin" />上传中 {entry.progress}%</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand-600" style={{ width: `${entry.progress}%` }} /></div></> : <><p className="text-xs leading-5 text-red-700">{entry.error}</p><div className="mt-2 grid grid-cols-2 gap-2"><button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md bg-red-50 text-sm font-bold text-red-700" onClick={() => void runUpload(entry)} type="button"><RefreshCw className="h-4 w-4" />重试</button><button className="min-h-10 rounded-md bg-slate-100 text-sm font-bold text-slate-700" onClick={() => discard(entry)} type="button">移除</button></div></>}</div>
    </div>)}</div> : null}
  </div>;
}
