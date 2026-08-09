import { Camera, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { createUuid } from '../../lib/uuid';
import { ProgressiveImage } from '../../components/ui/ProgressiveImage';
import type { ArrivalImageType, ArrivalImageWithUrl } from '../../services/arrival-images.service';

interface PendingUpload {
  error: string | null;
  file: File;
  id: string;
  previewUrl: string;
  progress: number;
  status: 'uploading' | 'error';
}

interface ArrivalImageSectionProps {
  embedded?: boolean;
  imageType: ArrivalImageType;
  images: ArrivalImageWithUrl[];
  imagesLoading?: boolean;
  onDelete: (image: ArrivalImageWithUrl) => Promise<void>;
  onUpload: (
    file: File,
    imageType: ArrivalImageType,
    onProgress: (progress: number) => void,
  ) => Promise<unknown>;
  prompt: string;
  title: string;
}

export function ArrivalImageSection({
  embedded = false,
  imageType,
  images,
  imagesLoading = false,
  onDelete,
  onUpload,
  prompt,
  title,
}: ArrivalImageSectionProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingUpload[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => () => {
    pendingRef.current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
  }, []);

  const runUpload = async (entry: PendingUpload) => {
    setPending((current) => current.map((item) => item.id === entry.id
      ? { ...item, error: null, progress: 5, status: 'uploading' }
      : item));
    try {
      await onUpload(entry.file, imageType, (progress) => {
        setPending((current) => current.map((item) => item.id === entry.id
          ? { ...item, progress }
          : item));
      });
      URL.revokeObjectURL(entry.previewUrl);
      setPending((current) => current.filter((item) => item.id !== entry.id));
    } catch (error) {
      setPending((current) => current.map((item) => item.id === entry.id
        ? {
            ...item,
            error: error instanceof Error ? error.message : '图片上传失败，请检查网络后重试。',
            status: 'error',
          }
        : item));
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const entry: PendingUpload = {
        error: null,
        file,
        id: createUuid(),
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        status: 'uploading',
      };
      setPending((current) => [...current, entry]);
      void runUpload(entry);
    });
  };

  const removeUploaded = async (image: ArrivalImageWithUrl) => {
    if (!window.confirm('确认删除这张图片吗？')) return;
    setMessage(null);
    try {
      await onDelete(image);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除图片失败，请重试。');
    }
  };

  const discardPending = (entry: PendingUpload) => {
    URL.revokeObjectURL(entry.previewUrl);
    setPending((current) => current.filter((item) => item.id !== entry.id));
  };

  return (
    <section className={embedded ? 'mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3' : 'ui-card p-3.5'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-red-700">必填</p>
          <h2 className="mt-0.5 text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">{prompt}</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{images.length} 张</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="ui-button-primary min-h-10 px-3" onClick={() => cameraRef.current?.click()} type="button">
          <Camera className="h-4 w-4" aria-hidden="true" />
          直接拍照
        </button>
        <button className="ui-button-secondary min-h-10 px-3" onClick={() => albumRef.current?.click()} type="button">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          相册选择
        </button>
      </div>
      <input ref={cameraRef} accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} type="file" />
      <input ref={albumRef} accept="image/jpeg,image/png,image/webp" className="hidden" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} type="file" />

      {message ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{message}</p> : null}

      {images.length === 0 && pending.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3 text-center text-sm text-slate-500">尚未上传图片</div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((image) => (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50" key={image.id}>
              <button className="block aspect-square w-full" disabled={!image.signedUrl} onClick={() => setSelectedUrl(image.signedUrl)} type="button">
                <ProgressiveImage alt={image.file_name} className="h-full w-full object-cover" containerClassName="h-full w-full" resourceLoading={imagesLoading && !image.signedUrl} src={image.signedUrl} />
              </button>
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />已上传</span>
                <button aria-label="删除图片" className="flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-red-700" onClick={() => void removeUploaded(image)} type="button"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </div>
          ))}

          {pending.map((entry) => (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50" key={entry.id}>
              <img alt="本地待上传预览" className="aspect-square w-full object-cover" src={entry.previewUrl} />
              <div className="p-2">
                {entry.status === 'uploading' ? (
                  <>
                    <p className="flex items-center gap-1 text-xs font-semibold text-slate-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />上传中 {entry.progress}%</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand-600" style={{ width: `${entry.progress}%` }} /></div>
                  </>
                ) : (
                  <>
                    <p className="text-xs leading-5 text-red-700">{entry.error}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md bg-red-50 text-sm font-bold text-red-700" onClick={() => void runUpload(entry)} type="button"><RefreshCw className="h-4 w-4" aria-hidden="true" />重试</button>
                      <button className="min-h-10 rounded-md bg-slate-100 text-sm font-bold text-slate-700" onClick={() => discardPending(entry)} type="button">移除</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true">
          <button aria-label="关闭图片预览" className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-900" onClick={() => setSelectedUrl(null)} type="button"><X className="h-6 w-6" aria-hidden="true" /></button>
          <img alt="到货图片大图预览" className="max-h-[88vh] max-w-full rounded-lg object-contain" src={selectedUrl} />
        </div>
      ) : null}
    </section>
  );
}
