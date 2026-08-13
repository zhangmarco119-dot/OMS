import { describe, expect, it } from 'vitest';

import {
  parseDisplayedVersion,
  validateProductionRelease,
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

  it('accepts an explicit patch, next minor, or next major release', () => {
    const previous = parseDisplayedVersion("version: 'StoreHub v2.1.36'");
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.1.37'"))).not.toThrow();
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.1.40'"))).not.toThrow();
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.2.0'"))).not.toThrow();
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v3.0.0'"))).not.toThrow();
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.1.36'"))).toThrow(/提升版本号/);
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v2.2.1'"))).toThrow(/提升版本号/);
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v3.0.1'"))).toThrow(/提升版本号/);
    expect(() => validateProductionRelease(previous, parseDisplayedVersion("version: 'StoreHub v4.0.0'"))).toThrow(/提升版本号/);
  });
});
