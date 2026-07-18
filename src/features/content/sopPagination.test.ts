import { describe, expect, it } from 'vitest';

import { appendSopPage } from './sopPagination';

describe('SOP administrator paging', () => {
  it('advances the server cursor even when a changing data set returns a duplicate card', () => {
    const result = appendSopPage([{ id: 'sop-1' }], [{ id: 'sop-1' }, { id: 'sop-2' }], 1, 4);
    expect(result).toEqual({ hasMore: true, items: [{ id: 'sop-1' }, { id: 'sop-2' }], nextOffset: 3 });
  });

  it('stops automatic loading when the server returns an empty page', () => {
    const result = appendSopPage([{ id: 'sop-1' }], [], 1, 4);
    expect(result).toEqual({ hasMore: false, items: [{ id: 'sop-1' }], nextOffset: 1 });
  });
});
