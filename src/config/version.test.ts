import { describe, expect, it } from 'vitest';

import { systemReleaseHistory, systemVersion } from './version';

describe('system release history', () => {
  it('derives the displayed version from a complete latest release note', () => {
    expect(systemReleaseHistory.length).toBeGreaterThan(0);
    expect(systemVersion).toBe(systemReleaseHistory[0].version);
    expect(systemReleaseHistory[0].title.trim()).not.toBe('');
    expect(systemReleaseHistory[0].highlights.length).toBeGreaterThan(0);
  });

  it('keeps every recorded version unique and documented in Chinese', () => {
    expect(new Set(systemReleaseHistory.map((release) => release.version)).size).toBe(systemReleaseHistory.length);
    for (const release of systemReleaseHistory) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.highlights.every((highlight) => /[\u4e00-\u9fff]/.test(highlight))).toBe(true);
    }
  });
});
