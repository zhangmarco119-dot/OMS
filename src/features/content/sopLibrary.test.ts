import { describe, expect, it } from 'vitest';

import type { SopLibraryEntry } from '../../services/v2-content.service';
import { filterSopLibrary } from './sopLibrary';

const sop = (id: string, title: string, category: string) => ({ category, id, title } as SopLibraryEntry);

describe('filterSopLibrary', () => {
  const sops = [sop('1', '芒果酸奶碗', '酸奶碗'), sop('2', '黑糖珍珠奶茶', '奶茶')];

  it('searches names and filters categories together', () => {
    expect(filterSopLibrary(sops, { category: '酸奶碗', query: '芒果' }).map((entry) => entry.id)).toEqual(['1']);
    expect(filterSopLibrary(sops, { category: '奶茶', query: '芒果' })).toEqual([]);
  });
});
