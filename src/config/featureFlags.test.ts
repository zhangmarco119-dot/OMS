import { describe, expect, it } from 'vitest';

import { parseFeatureFlag } from './featureFlags';

describe('feature flags', () => {
  it('enables a staged entry by default', () => {
    expect(parseFeatureFlag(undefined)).toBe(true);
  });

  it('can disable the staged entry explicitly', () => {
    expect(parseFeatureFlag('false')).toBe(false);
    expect(parseFeatureFlag(' FALSE ')).toBe(false);
  });
});
