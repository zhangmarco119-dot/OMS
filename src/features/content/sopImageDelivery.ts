import type { SupabaseClient } from '@supabase/supabase-js';

import {
  clearImageResourceCache,
  invalidateStorageImage,
  loadStorageImageResource,
  type StorageImageTransform,
} from '../../lib/imageResourceCache';
import type { Database } from '../../types/database';

type Client = SupabaseClient<Database>;

export type SopImageVariant = 'detail' | 'original' | 'thumbnail';

const THUMBNAIL_TRANSFORM_VERSION = 'square-center-v2';

const transformFor = (variant: SopImageVariant): StorageImageTransform | undefined => {
  if (variant === 'thumbnail') return { height: 256, quality: 60, resize: 'cover', width: 256 };
  if (variant === 'detail') return { quality: 72, resize: 'contain', width: 960 };
  return undefined;
};

const versionFor = (variant: SopImageVariant) =>
  variant === 'thumbnail' ? THUMBNAIL_TRANSFORM_VERSION : 'v1';

export const invalidateSopImageUrl = (path: string, variant?: SopImageVariant) => {
  const variants = variant
    ? [{ variant, version: versionFor(variant) }]
    : (['thumbnail', 'detail', 'original'] as const).map((entry) => ({
      variant: entry,
      version: versionFor(entry),
    }));
  invalidateStorageImage('v2-sop-assets', path, variants);
};

export const loadSopImageUrl = async (
  client: Client,
  path: string,
  variant: SopImageVariant,
  options: { forceRefresh?: boolean } = {},
) => loadStorageImageResource(client, 'v2-sop-assets', path, {
  forceRefresh: options.forceRefresh,
  scope: 'device',
  transform: transformFor(variant),
  variant,
  version: versionFor(variant),
});

export const clearSopImageDeliveryCache = () => {
  void clearImageResourceCache({ persistent: true });
};
