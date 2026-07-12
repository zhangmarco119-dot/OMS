import { describe, expect, it } from 'vitest';

import { createEmptyNoticeDraft, createEmptySopDraft } from './v2-content.service';

describe('v2 content drafts', () => {
  it('starts an announcement as an unpinned draft for selected stores', () => {
    expect(createEmptyNoticeDraft(['store-1'])).toEqual({
      body: '', id: null, isPinned: false, storeIds: ['store-1'], title: '',
    });
  });

  it('targets both store roles by default for a new SOP', () => {
    expect(createEmptySopDraft(['store-1'])).toMatchObject({
      category: '通用', id: null, roles: ['staff', 'manager'], storeIds: ['store-1'],
    });
  });
});
