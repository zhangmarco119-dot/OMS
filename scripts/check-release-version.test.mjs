import { describe, expect, it } from 'vitest';

import {
  parseDisplayedVersion,
  validateProductionMinorRelease,
  validateVersionMetadata,
} from './check-release-version.mjs';

describe('release version policy', () => {
  it('parses the latest displayed semantic version', () => {
    expect(parseDisplayedVersion("version: 'StoreHub v2.2.0'")).toEqual({
      major: 2,
      minor: 2,
      patch: 0,
      value: '2.2.0',
    });
  });

  it('requires package metadata to match the displayed version', () => {
    const version = parseDisplayedVersion("version: 'StoreHub v2.2.0'");
    expect(() => validateVersionMetadata(version, '2.2.0')).not.toThrow();
    expect(() => validateVersionMetadata(version, '2.1.36')).toThrow(/不一致/);
  });

  it('requires every production merge to advance exactly one minor version', () => {
    const previous = parseDisplayedVersion("version: 'StoreHub v2.1.36'");
    const current = parseDisplayedVersion("version: 'StoreHub v2.2.0'");
    expect(() => validateProductionMinorRelease(previous, current)).not.toThrow();
    expect(() => validateProductionMinorRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.1.37'"))).toThrow(/2\.2\.0/);
    expect(() => validateProductionMinorRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.2.1'"))).toThrow(/2\.2\.0/);
  });
});
