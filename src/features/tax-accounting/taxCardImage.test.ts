import { describe, expect, it } from 'vitest';

import { taxCardFileName } from './taxCardImage';

describe('taxCardFileName', () => {
  it('移除文件名中的系统保留字符', () => {
    expect(taxCardFileName('门店/A:B', '2026-07')).toBe('门店-A-B-2026-07-员工个税申报.png');
  });
});
