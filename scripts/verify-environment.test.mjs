import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { extractSupabaseProjectRef, validateEnvironment } from './verify-environment.mjs';

const productionRef = 'mxxxpyowccezplfeffms';
const developmentRef = 'dddddddddddddddddddd';
const productionKey = 'test_public_key_for_production_environment';
const developmentKey = 'test_public_key_for_development_environment';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const base = {
  STOREHUB_DEVELOPMENT_SUPABASE_REF: developmentRef,
  STOREHUB_PRODUCTION_SUPABASE_REF: productionRef,
};
const policyConfig = {
  productionProjectRef: productionRef,
  productionAnonKeySha256: sha256(productionKey),
  developmentProjectRef: developmentRef,
  developmentAnonKeySha256: sha256(developmentKey),
  branches: { 'manage-system': 'production', 'v2-development': 'development' },
};

describe('StoreHub environment guard', () => {
  it('allows each release branch to use only its assigned project', () => {
    expect(validateEnvironment({ branch: 'v2-development', env: { ...base, VITE_APP_ENV: 'development', VITE_SUPABASE_URL: `https://${developmentRef}.supabase.co`, VITE_SUPABASE_ANON_KEY: developmentKey }, policyConfig }).errors).toEqual([]);
    expect(validateEnvironment({ branch: 'manage-system', env: { ...base, VITE_APP_ENV: 'production', VITE_SUPABASE_URL: `https://${productionRef}.supabase.co`, VITE_SUPABASE_ANON_KEY: productionKey }, policyConfig }).errors).toEqual([]);
  });

  it('blocks branch and database cross-wiring', () => {
    const result = validateEnvironment({ branch: 'v2-development', env: { ...base, VITE_APP_ENV: 'development', VITE_SUPABASE_URL: `https://${productionRef}.supabase.co`, VITE_SUPABASE_ANON_KEY: developmentKey }, policyConfig });
    expect(result.errors).toContain('禁止 v2-development 连接正式 Supabase。');
  });

  it('blocks identical environment project references and linked CLI mismatches', () => {
    const duplicate = validateEnvironment({ branch: 'manage-system', env: { ...base, STOREHUB_DEVELOPMENT_SUPABASE_REF: productionRef, VITE_APP_ENV: 'production', VITE_SUPABASE_URL: `https://${productionRef}.supabase.co`, VITE_SUPABASE_ANON_KEY: productionKey }, policyConfig });
    expect(duplicate.errors).toContain('开发和正式 Supabase 项目编号必须不同。');
    const linked = validateEnvironment({ branch: 'v2-development', env: { ...base, VITE_APP_ENV: 'development', VITE_SUPABASE_URL: `https://${developmentRef}.supabase.co`, VITE_SUPABASE_ANON_KEY: developmentKey }, linkedProjectRef: productionRef, policyConfig });
    expect(linked.errors.some((error) => error.includes('CLI 当前链接项目'))).toBe(true);
  });

  it('extracts only canonical Supabase project URLs', () => {
    expect(extractSupabaseProjectRef(`https://${developmentRef}.supabase.co`)).toBe(developmentRef);
    expect(extractSupabaseProjectRef('https://example.com')).toBeNull();
  });
});
