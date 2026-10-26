const { createHash } = require('node:crypto');
exports.validateNativeConfig = (config, policy, environment) => {
  if (!['development','production'].includes(environment)) throw new Error('Unsupported build environment');
  const expected = policy[environment+'SelfHosted'];
  if (config?.VITE_SUPABASE_URL !== expected.url) throw new Error('Mini Program must use the registered self-hosted backend');
  const fingerprint = createHash('sha256').update(config.VITE_SUPABASE_ANON_KEY || '').digest('hex');
  if (fingerprint !== expected.anonKeySha256) throw new Error('Public key fingerprint mismatch');
  return { VITE_SUPABASE_URL: expected.url, VITE_SUPABASE_ANON_KEY: config.VITE_SUPABASE_ANON_KEY, VITE_APP_ENV: environment, DEV: false, PROD: true };
};
exports.validateDevelopmentConfig = (config, policy) => exports.validateNativeConfig(config, policy, 'development');
