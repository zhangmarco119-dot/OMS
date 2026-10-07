import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('public/downloads/android.json', 'utf8'));
describe('Published Android installers', () => {
  for (const environment of ['development', 'production']) {
    it(`ships the ${environment} APK with the recorded SHA-256`, () => {
      const entry = manifest.packages[environment];
      const apk = readFileSync(`public${entry.path}`);
      expect(entry.path).toBe(`/downloads/storehub-${environment}.apk`);
      expect(apk.subarray(0, 4).toString('hex')).toBe('504b0304');
      expect(createHash('sha256').update(apk).digest('hex')).toBe(entry.sha256);
    });
  }
});
