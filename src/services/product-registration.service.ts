import type { SupabaseClient } from '@supabase/supabase-js';

import { compressArrivalImage } from './arrival-images.service';
import { createUuid } from '../lib/uuid';
import { invalidateStorageImage, loadStorageImageResource, primeImageResource, storageImageCacheKey } from '../lib/imageResourceCache';
import type { Database } from '../types/database';

type Client = SupabaseClient<Database>;
type EntryRow = Database['public']['Tables']['product_registration_entries']['Row'];
type ImageRow = Database['public']['Tables']['product_registration_images']['Row'];
export type RegistrationProduct = Pick<Database['public']['Tables']['products']['Row'], 'count_unit' | 'id' | 'name' | 'spec'>;
export type ProductRegistrationType = EntryRow['registration_type'];
export type ProductRegistrationImage = ImageRow & { signedUrl: string };
export type ProductRegistrationEntry = EntryRow & { creatorName: string; images: ProductRegistrationImage[] };

export const PRODUCT_REGISTRATION_TYPES: Array<{ key: ProductRegistrationType; label: string }> = [
  { key: 'packaging', label: '打包货品' },
  { key: 'abandoned', label: '遗弃货品' },
  { key: 'loaned_to_wudaokou', label: '借用到五道口的货品' },
  { key: 'equipment', label: '设备' },
  { key: 'other', label: '其他' },
];

const bucket = 'product-registration-images';
const extensionForMime = (mime: string) => mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
const imageOptions = { scope: 'session' as const, variant: 'product-registration' };

export const isProductRegistrationType = (value: string | null): value is ProductRegistrationType =>
  PRODUCT_REGISTRATION_TYPES.some((item) => item.key === value);

export const loadRegistrationProducts = async (client: Client, storeId: string): Promise<RegistrationProduct[]> => {
  const { data, error } = await client.from('products').select('id,name,spec,count_unit').eq('store_id', storeId).eq('is_active', true).order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const loadProductRegistrationEntries = async (client: Client, storeId: string, creatorId?: string): Promise<ProductRegistrationEntry[]> => {
  let query = client.from('product_registration_entries').select('*').eq('store_id', storeId).order('updated_at', { ascending: false });
  if (creatorId) query = query.eq('created_by', creatorId);
  const { data: entryRows, error: entryError } = await query;
  if (entryError) throw new Error(entryError.message);
  const entries = entryRows ?? [];
  const ids = entries.map((entry) => entry.id);
  const [imageResult, profileResult] = await Promise.all([
    ids.length ? client.from('product_registration_images').select('*').in('entry_id', ids).order('created_at') : Promise.resolve({ data: [], error: null }),
    entries.length ? client.from('profiles').select('id,display_name').in('id', [...new Set(entries.map((entry) => entry.created_by))]) : Promise.resolve({ data: [], error: null }),
  ]);
  if (imageResult.error) throw new Error(imageResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);
  const imagesByEntry = new Map<string, ProductRegistrationImage[]>();
  for (const image of imageResult.data ?? []) {
    const current = imagesByEntry.get(image.entry_id) ?? [];
    current.push({ ...image, signedUrl: '' });
    imagesByEntry.set(image.entry_id, current);
  }
  const nameByProfile = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.display_name]));
  return entries.map((entry) => ({ ...entry, creatorName: nameByProfile.get(entry.created_by) ?? '员工', images: imagesByEntry.get(entry.id) ?? [] }));
};

export const loadProductRegistrationImageUrls = async (client: Client, images: ProductRegistrationImage[]) => Object.fromEntries(await Promise.all(images.map(async (image) => [
  image.id,
  await loadStorageImageResource(client, bucket, image.object_path, imageOptions),
])));

export const createProductRegistrationEntry = async (client: Client, input: { creatorId: string; storeId: string; type: ProductRegistrationType }) => {
  const { data, error } = await client.from('product_registration_entries').insert({ created_by: input.creatorId, registration_type: input.type, store_id: input.storeId }).select('*').single();
  if (error) throw new Error(error.message);
  return { ...data, creatorName: '', images: [] } as ProductRegistrationEntry;
};

export const updateProductRegistrationEntry = async (client: Client, entryId: string, patch: Pick<Database['public']['Tables']['product_registration_entries']['Update'], 'note' | 'product_id' | 'product_name' | 'unit'>) => {
  const { error } = await client.from('product_registration_entries').update(patch).eq('id', entryId);
  if (error) throw new Error(error.message);
};

export const deleteProductRegistrationEntry = async (client: Client, entry: ProductRegistrationEntry) => {
  const { error } = await client.from('product_registration_entries').delete().eq('id', entry.id);
  if (error) throw new Error(error.message);
  if (entry.images.length) {
    const removal = await client.storage.from(bucket).remove(entry.images.map((image) => image.object_path));
    if (removal.error) throw new Error('登记记录已删除，但图片存储清理失败。');
    entry.images.forEach((image) => invalidateStorageImage(bucket, image.object_path, [imageOptions]));
  }
};

export const uploadProductRegistrationImage = async (client: Client, input: { entryId: string; file: File; profileId: string; storeId: string }, onProgress?: (progress: number) => void): Promise<ProductRegistrationImage> => {
  onProgress?.(10);
  const processed = await compressArrivalImage(input.file);
  onProgress?.(35);
  const id = createUuid();
  const objectPath = `${input.storeId}/${input.entryId}/${id}.${extensionForMime(processed.mimeType)}`;
  const upload = await client.storage.from(bucket).upload(objectPath, processed.blob, { cacheControl: '3600', contentType: processed.mimeType, upsert: false });
  if (upload.error) throw new Error(upload.error.message);
  onProgress?.(75);
  const { data, error } = await client.from('product_registration_images').insert({
    bucket,
    entry_id: input.entryId,
    file_name: input.file.name || `${id}.${extensionForMime(processed.mimeType)}`,
    height: processed.height,
    mime_type: processed.mimeType,
    object_path: objectPath,
    size_bytes: processed.blob.size,
    store_id: input.storeId,
    uploaded_by: input.profileId,
    width: processed.width,
  }).select('*').single();
  if (error) {
    await client.storage.from(bucket).remove([objectPath]);
    throw new Error(error.message);
  }
  const signedUrl = await primeImageResource(storageImageCacheKey(bucket, objectPath, imageOptions), processed.blob)
    ?? await loadStorageImageResource(client, bucket, objectPath, imageOptions);
  onProgress?.(100);
  return { ...data, signedUrl } as ProductRegistrationImage;
};

export const deleteProductRegistrationImage = async (client: Client, image: ProductRegistrationImage) => {
  const { error } = await client.from('product_registration_images').delete().eq('id', image.id);
  if (error) throw new Error(error.message);
  const removal = await client.storage.from(bucket).remove([image.object_path]);
  invalidateStorageImage(bucket, image.object_path, [imageOptions]);
  if (removal.error) throw new Error('图片记录已删除，但图片存储清理失败。');
};
