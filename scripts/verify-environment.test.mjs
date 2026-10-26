import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { extractSupabaseProjectRef, validateCloudEnvironmentLink, validateEnvironment } from './verify-environment.mjs';
import path from 'node:path';

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
  it('accepts only the registered cloud database for the selected release environment', () => {
    const config = { projectRef: productionRef, container: 'supabase_db_storehub-local-production', host: '192.0.2.1', user: 'ubuntu', identityFile: path.resolve('key'), knownHostsFile: path.resolve('known_hosts') };
    expect(validateCloudEnvironmentLink(config, 'production', productionRef)).toEqual([]);
    expect(validateCloudEnvironmentLink(config, 'development', developmentRef)).not.toEqual([]);
    for (const changed of [{ container: 'supabase_db_storehub-local-development' }, { projectRef: developmentRef }, { host: 'host;command' }, { identityFile: 'relative-key' }]) {
      expect(validateCloudEnvironmentLink({ ...config, ...changed }, 'production', productionRef)).not.toEqual([]);
    }
    expect(validateCloudEnvironmentLink(null, 'production', productionRef)).not.toEqual([]);
  });
  it('isolates registered production and development self-hosted credentials', () => {
    const key = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"anon"}').toString('base64url')}.production`;
    const url = 'https://oms-store-management.pages.dev/backend';
    const config = {...policyConfig,productionSelfHosted:{url,anonKeySha256:sha256(key)}};
    const env = {...base,VITE_APP_ENV:'production',VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:key};
    expect(validateEnvironment({branch:'manage-system',env,policyConfig:config}).errors).toEqual([]);
    expect(validateEnvironment({branch:'v2-development',env:{...env,VITE_APP_ENV:'development'},policyConfig:config}).errors.length).toBeGreaterThan(0);
    expect(validateEnvironment({branch:'manage-system',env:{...env,VITE_SUPABASE_ANON_KEY:developmentKey},policyConfig:config}).errors.length).toBeGreaterThan(0);
  });
  it('allows only the registered development self-hosted URL and anon fingerprint', () => {
    const key = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"anon"}').toString('base64url')}.test`;
    const url = 'https://oms-store-development.pages.dev/backend';
    const config = {...policyConfig,developmentSelfHosted:{url,anonKeySha256:sha256(key)}};
    const env = {...base,VITE_APP_ENV:'development',VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:key};
    expect(validateEnvironment({branch:'v2-development',env,policyConfig:config}).errors).toEqual([]);
    expect(validateEnvironment({branch:'manage-system',env:{...env,VITE_APP_ENV:'production'},policyConfig:config}).errors.length).toBeGreaterThan(0);
    expect(validateEnvironment({branch:'v2-development',env:{...env,VITE_SUPABASE_ANON_KEY:developmentKey},policyConfig:config}).errors.length).toBeGreaterThan(0);
    expect(validateEnvironment({branch:'v2-development',env:{...env,VITE_SUPABASE_URL:'https://other.example/backend'},policyConfig:config}).errors.length).toBeGreaterThan(0);
  });
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
