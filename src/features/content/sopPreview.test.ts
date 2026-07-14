import { describe, expect, it } from 'vitest';

import type { SopListItem } from '../../services/v2-content.service';
import { getSopPreviewAsset } from './sopPreview';

const asset = (id: string, assetKind: 'step' | 'cover', sortOrder: number, createdAt: string) => ({
  asset_kind: assetKind,
  bucket: 'v2-sop-assets',
  created_at: createdAt,
  file_name: `${id}.jpg`,
  id,
  mime_type: 'image/jpeg',
  object_path: `sop-1/${id}.jpg`,
  signedUrl: `https://example.test/${id}.jpg`,
  size_bytes: 100,
  sop_id: 'sop-1',
  sort_order: sortOrder,
  step_text: '',
  uploaded_by: 'admin-1',
}) as SopListItem['assetUrls'][number];

describe('getSopPreviewAsset', () => {
  it('prefers the explicitly uploaded product cover', () => {
    const preview = getSopPreviewAsset({ assetUrls: [
      asset('step-latest', 'step', 9, '2026-07-14T12:00:00Z'),
      asset('cover', 'cover', 0, '2026-07-14T10:00:00Z'),
    ] });

    expect(preview?.id).toBe('cover');
  });

  it('falls back to the last ordered production step', () => {
    const preview = getSopPreviewAsset({ assetUrls: [
      asset('step-first', 'step', 0, '2026-07-14T12:00:00Z'),
      asset('step-last', 'step', 2, '2026-07-14T10:00:00Z'),
    ] });

    expect(preview?.id).toBe('step-last');
  });

  it('ignores a later text-only step when choosing the preview image', () => {
    const textOnly = { ...asset('text-only', 'step', 3, '2026-07-14T13:00:00Z'), file_name: null, mime_type: null, object_path: null, signedUrl: null, size_bytes: 0, step_text: '纯文字步骤' };
    const preview = getSopPreviewAsset({ assetUrls: [asset('image-step', 'step', 1, '2026-07-14T10:00:00Z'), textOnly] });

    expect(preview?.id).toBe('image-step');
  });
});
