const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { validateDevelopmentConfig, validateNativeConfig } = require('./native-build-environment.cjs');
const policy = { developmentSelfHosted: { url: 'https://test.example/backend', anonKeySha256: createHash('sha256').update('test-public-key').digest('hex') } };
test('native build pins the active test backend and its registered public key', () => {
  const result = validateDevelopmentConfig({ VITE_SUPABASE_URL: policy.developmentSelfHosted.url, VITE_SUPABASE_ANON_KEY: 'test-public-key' }, policy);
  assert.equal(result.VITE_APP_ENV, 'development');
  for (const url of ['https://old.supabase.co', 'https://production.example/backend', 'https://test.example/other']) assert.throws(() => validateDevelopmentConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'test-public-key' }, policy), /backend/);
  assert.throws(() => validateDevelopmentConfig({ VITE_SUPABASE_URL: policy.developmentSelfHosted.url, VITE_SUPABASE_ANON_KEY: 'other-key' }, policy), /fingerprint/);
});
test('production and development cannot exchange backend URLs or public keys', () => {
  const both = { ...policy, productionSelfHosted: { url: 'https://production.example/backend', anonKeySha256: createHash('sha256').update('production-key').digest('hex') } };
  const production = { VITE_SUPABASE_URL: both.productionSelfHosted.url, VITE_SUPABASE_ANON_KEY: 'production-key' };
  assert.equal(validateNativeConfig(production, both, 'production').VITE_APP_ENV, 'production');
  assert.throws(() => validateNativeConfig(production, both, 'development'), /backend/);
  assert.throws(() => validateNativeConfig({ ...production, VITE_SUPABASE_ANON_KEY: 'test-public-key' }, both, 'production'), /fingerprint/);
  assert.throws(() => validateNativeConfig(production, both, 'unknown'), /environment/);
});
