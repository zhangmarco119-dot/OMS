import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSopCollectionHtml } from './sopExport';
import type { SopListItem } from '../../services/v2-content.service';

const sop = {
  assetUrls: [
    { asset_kind: 'step', file_name: '步骤一.jpg', id: 'step-1', signedUrl: 'https://example.test/step.jpg', sort_order: 0, step_text: '加入酸奶并铺平。' },
    { asset_kind: 'attachment', file_name: '配方表.pdf', id: 'attachment-1', signedUrl: 'https://example.test/recipe.pdf', sort_order: 0, step_text: '' },
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
    expect(result.html).toContain('加入酸奶并铺平。');
    expect(result.html).toContain('配方表.pdf');
    expect(result.html).toContain('data:image/jpeg;base64,');
    expect(result.html).toContain('data:application/pdf;base64,');
    expect(result.html).not.toContain('https://example.test');
  });
});
