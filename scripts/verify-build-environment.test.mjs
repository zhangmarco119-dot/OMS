import { describe, expect, it } from 'vitest';

import packageJson from '../package.json' with { type: 'json' };
import { verifyBundleEnvironment, verifyReleaseArtifacts } from './verify-build-environment.mjs';

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

  it('requires an aligned release manifest and safe Cloudflare cache rules', () => {
    const manifest = {
      buildId: `${packageJson.version}+abcdef123456`,
      builtAt: '2026-07-20T00:00:00.000Z',
      databaseContract: 1,
      environment: 'development',
      schema: 1,
      version: packageJson.version,
    };
    expect(verifyReleaseArtifacts({
      bundleText: `bundle:${manifest.buildId}`,
      expectedEnvironment: 'development',
      headersText: '/version.json\n Cache-Control: no-store\n/assets/*\n Cache-Control: immutable',
      manifest,
    })).toEqual([]);
    expect(verifyReleaseArtifacts({
      bundleText: 'old-build',
      expectedEnvironment: 'production',
      headersText: '',
      manifest,
    }).length).toBeGreaterThan(2);
  });
});
