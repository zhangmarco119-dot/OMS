import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSopCollectionHtml } from './sopExport';
import type { SopListItem } from '../../services/v2-content.service';

const sop = {
  assetUrls: [
    { asset_kind: 'step', file_name: null, id: 'text-step', object_path: null, signedUrl: null, sort_order: 0, step_text: '纯文字步骤：静置十分钟。' },
    { asset_kind: 'step', file_name: '步骤二.jpg', id: 'image-step', object_path: 'sop-1/step.jpg', signedUrl: 'https://example.test/step.jpg', sort_order: 1, step_text: '' },
    { asset_kind: 'attachment', file_name: '配方表.pdf', id: 'attachment-1', object_path: 'sop-1/recipe.pdf', signedUrl: 'https://example.test/recipe.pdf', sort_order: 0, step_text: '' },
  ],
  body: '制作前清洁操作台。',
  category: '酸奶碗',
  effective_at: null,
  id: 'sop-1',
  roles: ['staff', 'manager'],
  status: 'published',
  storeIds: ['store-1'],
  taskTemplateId: null,
  title: '芒果酸奶碗',
} as unknown as SopListItem;

describe('SOP collection export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('embeds selected SOP images and attachments into one printable HTML file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve({
      blob: () => Promise.resolve({
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(url.includes('pdf') ? 'pdf' : 'image').buffer),
        type: url.includes('pdf') ? 'application/pdf' : 'image/jpeg',
      }),
      ok: true,
    })));

    const result = await buildSopCollectionHtml([sop], () => '测试门店');

    expect(result.missingAssetCount).toBe(0);
    expect(result.html).toContain('SOP 合集');
    expect(result.html).toContain('芒果酸奶碗');
    expect(result.html).toContain('纯文字步骤：静置十分钟。');
    expect(result.html).toContain('配方表.pdf');
    expect(result.html).toContain('data:image/jpeg;base64,');
    expect(result.html).toContain('data:application/pdf;base64,');
    expect(result.html).not.toContain('请按图示');
    expect(result.html).not.toContain('https://example.test');
  });
});
