import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { validateArrivalImageFile } from '../../services/arrival-images.service';

export function usePenaltyImages() {
  const [files, setFiles] = useState<File[]>([]);
  const [imageError, setImageError] = useState('');
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);
  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!selected.length) return;
    const valid: File[] = [];
    const errors: string[] = [];
    for (const file of selected) {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const inferredType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : '';
      const candidate = !file.type && inferredType ? new File([file], file.name, { type: inferredType, lastModified: file.lastModified }) : file;
      try { validateArrivalImageFile(candidate); valid.push(candidate); }
      catch (error) { errors.push(`${file.name || '图片'}：${error instanceof Error ? error.message : '无法读取图片。'}`); }
    }
    if (valid.length) setFiles((current) => [...current, ...valid]);
    setImageError(errors.join('；'));
  };
  // Some Android gallery providers return multi-select results that WebView drops.
  // Single selection reliably returns a file; repeated selections are appended.
  const allowMultiple = typeof navigator === 'undefined' || !/Android/i.test(navigator.userAgent);
  return { files, setFiles, previews, imageError, selectImages, allowMultiple, clearImageError: () => setImageError('') };
}
