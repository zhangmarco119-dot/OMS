import { describe, expect, it } from 'vitest';

import { createReleaseManifest, createReleaseMetadata } from './release-manifest.mjs';

describe('release manifest', () => {
  it('uses version and commit to create a rollback-safe exact build id', () => {
    const metadata = createReleaseMetadata({
      appEnvironment: 'production',
      commitSha: 'ABCDEF1234567890',
      packageVersion: '2.4.4',
    });
    expect(metadata).toMatchObject({
      buildId: '2.4.4+abcdef123456',
      databaseContract: 1,
      environment: 'production',
      version: '2.4.4',
    });
    expect(createReleaseManifest(metadata).schema).toBe(1);
  });

  it('uses a stable local suffix when no deployment commit is available', () => {
    expect(createReleaseMetadata({
      appEnvironment: 'development',
      commitSha: '',
      packageVersion: '2.4.4',
    }).buildId).toBe('2.4.4+local');
  });
});
