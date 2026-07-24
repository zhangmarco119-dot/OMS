import type { SupabaseClient } from '@supabase/supabase-js';
import { compressArrivalImage } from './arrival-images.service';
import {
  invalidateStorageImage,
  loadStorageImageResource,
  primeImageResource,
  storageImageCacheKey,
} from '../lib/imageResourceCache';
import { createUuid } from '../lib/uuid';
import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
type Row = Database['public']['Tables']['operation_report_images']['Row'];
export type OperationReportImage = Row & { signedUrl: string };
const bucket = 'operation-report-images';
const extension = (mime: string) => mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
const signed = async (client: Client, path: string) => loadStorageImageResource(client, bucket, path, {
  scope: 'session',
  variant: 'operation-report',
});

export async function loadOperationReportImages(client: Client, reportId: string) {
  const { data, error } = await client.from('operation_report_images').select('*').eq('report_id', reportId).order('created_at');
  if (error) throw new Error(error.message);
  return Promise.all((data ?? []).map(async (row) => ({ ...row, signedUrl: await signed(client, row.object_path) })));
}

export async function uploadOperationReportImage(client: Client, input: { fieldId: string; file: File; profileId: string; reportId: string; storeId: string }, onProgress?: (value: number) => void) {
  onProgress?.(10); const image = await compressArrivalImage(input.file); onProgress?.(35);
  const id = createUuid(); const objectPath = `${input.storeId}/${input.reportId}/${input.fieldId}/${id}.${extension(image.mimeType)}`;
  const old = await client.from('operation_report_images').select('*').eq('report_id', input.reportId).eq('field_id', input.fieldId).maybeSingle();
  const upload = await client.storage.from(bucket).upload(objectPath, image.blob, { contentType: image.mimeType, upsert: false });
  if (upload.error) throw new Error(upload.error.message); onProgress?.(70);
  if (old.data) {
    await client.from('operation_report_images').delete().eq('id', old.data.id);
    await client.storage.from(bucket).remove([old.data.object_path]);
    invalidateStorageImage(bucket, old.data.object_path, [{ variant: 'operation-report' }]);
  }
  const saved = await client.from('operation_report_images').insert({ bucket, field_id: input.fieldId, file_name: input.file.name, height: image.height, mime_type: image.mimeType, object_path: objectPath, report_id: input.reportId, size_bytes: image.blob.size, store_id: input.storeId, uploaded_by: input.profileId, width: image.width }).select('*').single();
  if (saved.error) { await client.storage.from(bucket).remove([objectPath]); throw new Error(saved.error.message); }
  const signedUrl = await primeImageResource(
    storageImageCacheKey(bucket, objectPath, { variant: 'operation-report' }),
    image.blob,
  ) ?? await signed(client, objectPath);
  onProgress?.(100); return { ...saved.data, signedUrl } as OperationReportImage;
}

export async function removeOperationReportImage(client: Client, image: OperationReportImage) {
  const removed = await client.from('operation_report_images').delete().eq('id', image.id);
  if (removed.error) throw new Error(removed.error.message);
  await client.storage.from(bucket).remove([image.object_path]);
  invalidateStorageImage(bucket, image.object_path, [{ variant: 'operation-report' }]);
}

export async function downloadOperationReportImage(client: Client, image: OperationReportImage) {
  const { data, error } = await client.storage.from(bucket).download(image.object_path);
  if (error || !data) throw new Error(error?.message || '现场图片下载失败。');
  const objectUrl = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = image.file_name || '运营报告现场图片';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
