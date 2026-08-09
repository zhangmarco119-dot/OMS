import type { SupabaseClient } from '@supabase/supabase-js';

import {
  invalidateStorageImage,
  loadStorageImageResource,
  primeImageResource,
  storageImageCacheKey,
} from '../lib/imageResourceCache';
import { createUuid } from '../lib/uuid';
import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
type ArrivalImageRow = Database['public']['Tables']['arrival_report_images']['Row'];
export type ArrivalImageType = ArrivalImageRow['image_type'];

export interface ArrivalImageWithUrl extends ArrivalImageRow {
  signedUrl: string;
}

export interface ProcessedArrivalImage {
  blob: Blob;
  height: number;
  mimeType: ArrivalImageRow['mime_type'];
  width: number;
}

const bucket = 'arrival-report-images';
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const validateArrivalImageFile = (file: File) => {
  if (!allowedTypes.has(file.type)) {
    throw new Error('只支持 JPG、PNG 或 WEBP 图片。');
  }
  if (file.size <= 0) {
    throw new Error('图片文件为空，请重新选择。');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('原始图片不能超过 20 MB。');
  }
};

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('无法读取图片，请重新拍摄或选择。'));
  };
  image.src = url;
});

export const compressArrivalImage = async (file: File): Promise<ProcessedArrivalImage> => {
  validateArrivalImageFile(file);
  const image = await loadImage(file);
  const maxSide = 2000;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前浏览器无法处理图片，请更换浏览器后重试。');
  }
  context.drawImage(image, 0, 0, width, height);

  const requestedMimeType = file.type as ProcessedArrivalImage['mimeType'];
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('图片压缩失败，请重试。')),
      requestedMimeType,
      requestedMimeType === 'image/png' ? undefined : 0.82,
    );
  });

  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('压缩后的图片仍超过 10 MB，请降低相机分辨率后重试。');
  }
  const mimeType = allowedTypes.has(blob.type)
    ? blob.type as ProcessedArrivalImage['mimeType']
    : requestedMimeType;
  return { blob, height, mimeType, width };
};

const extensionForMime = (mimeType: ProcessedArrivalImage['mimeType']) => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
};

const createSignedUrl = async (client: Client, objectPath: string) => {
  return loadStorageImageResource(client, bucket, objectPath, {
    scope: 'session',
    variant: 'arrival',
  });
};

export const loadArrivalImages = async (client: Client, reportId: string) => {
  const images = await loadArrivalImageMetadata(client, reportId);
  const urls = await loadArrivalImageUrls(client, images);
  return images.map((image) => ({ ...image, signedUrl: urls[image.id] ?? '' }));
};

export const loadArrivalImageMetadata = async (client: Client, reportId: string): Promise<ArrivalImageWithUrl[]> => {
  const { data, error } = await client
    .from('arrival_report_images')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((image) => ({ ...image, signedUrl: '' }));
};

export const loadArrivalImageUrls = async (
  client: Client,
  images: ArrivalImageWithUrl[],
): Promise<Record<string, string>> => Object.fromEntries(await Promise.all(images.map(async (image) => [
  image.id,
  await createSignedUrl(client, image.object_path),
])));

export const uploadArrivalImage = async (
  client: Client,
  input: {
    arrivalItemId?: string | null;
    file: File;
    imageType: ArrivalImageType;
    profileId: string;
    reportId: string;
    storeId: string;
  },
  onProgress?: (progress: number) => void,
): Promise<ArrivalImageWithUrl> => {
  onProgress?.(10);
  const processed = await compressArrivalImage(input.file);
  onProgress?.(35);
  const objectId = createUuid();
  const objectPath = `${input.storeId}/${input.reportId}/${input.imageType}/${objectId}.${extensionForMime(processed.mimeType)}`;
  const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, processed.blob, {
    cacheControl: '3600',
    contentType: processed.mimeType,
    upsert: false,
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }
  onProgress?.(75);

  const { data: metadata, error: metadataError } = await client
    .from('arrival_report_images')
    .insert({
      arrival_item_id: input.imageType === 'goods' ? input.arrivalItemId ?? null : null,
      bucket,
      file_name: input.file.name || `${objectId}.${extensionForMime(processed.mimeType)}`,
      height: processed.height,
      image_type: input.imageType,
      mime_type: processed.mimeType,
      object_path: objectPath,
      report_id: input.reportId,
      size_bytes: processed.blob.size,
      store_id: input.storeId,
      uploaded_by: input.profileId,
      width: processed.width,
    })
    .select('*')
    .single();

  if (metadataError) {
    await client.storage.from(bucket).remove([objectPath]);
    throw new Error(metadataError.message);
  }

  const signedUrl = await primeImageResource(
    storageImageCacheKey(bucket, objectPath, { variant: 'arrival' }),
    processed.blob,
  ) ?? await createSignedUrl(client, objectPath);
  onProgress?.(100);
  return { ...metadata, signedUrl };
};

export const removeArrivalImage = async (client: Client, image: ArrivalImageWithUrl) => {
  const { error: metadataError } = await client
    .from('arrival_report_images')
    .delete()
    .eq('id', image.id);
  if (metadataError) {
    throw new Error(metadataError.message);
  }

  const { error: storageError } = await client.storage.from(bucket).remove([image.object_path]);
  invalidateStorageImage(bucket, image.object_path, [
    { variant: 'arrival' },
    { variant: 'original' },
  ]);
  if (storageError) {
    throw new Error('图片记录已删除，但存储清理失败，请联系管理员处理。');
  }
};
