import { describe, expect, it } from 'vitest';

import { verifyBundleEnvironment } from './verify-build-environment.mjs';

describe('build environment verification', () => {
  it('accepts only the assigned project URL', () => {
    expect(verifyBundleEnvironment({
      bundleText: 'https://dddddddddddddddddddd.supabase.co',
      expectedProjectRef: 'dddddddddddddddddddd',
      forbiddenProjectRefs: ['pppppppppppppppppppp'],
    })).toEqual([]);
  });

  it('rejects a missing expected URL and a cross-wired URL', () => {
    const errors = verifyBundleEnvironment({
      bundleText: 'https://pppppppppppppppppppp.supabase.co',
      expectedProjectRef: 'dddddddddddddddddddd',
      forbiddenProjectRefs: ['pppppppppppppppppppp'],
    });
    expect(errors).toHaveLength(2);
  });
});
