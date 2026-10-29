const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createNativeGlobals } = require('./native-globals.cjs');
const root = path.resolve(__dirname, '../..'), rootRequire = createRequire(path.join(root, 'package.json'));
const esbuild = createRequire(rootRequire.resolve('vite'))('esbuild');
test('real auth SDK recognizes scoped native storage across independent page runtimes', async () => {
  const authPackage = fs.readdirSync(path.join(root, 'node_modules/.pnpm')).find(n => n.startsWith('@supabase+auth-js@'));
  const helpers = path.join(root, 'node_modules/.pnpm', authPackage, 'node_modules/@supabase/auth-js/src/lib/helpers.ts');
  const built = await esbuild.build({ stdin: { contents: 'export { supportsLocalStorage } from ' + JSON.stringify(helpers.replaceAll('\\', '/')), resolveDir: root }, bundle: true, write: false, format: 'cjs', platform: 'browser', define: createNativeGlobals() });
  const values = new Map();
  const storage = { setItem: (k,v) => values.set(k,v), getItem: k => values.get(k) ?? null, removeItem: k => values.delete(k) };
  const loadPage = () => {
    const module = { exports: {} };
    vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, window: { localStorage: storage }, document: {}, console });
    return module.exports;
  };
  assert.equal(loadPage().supportsLocalStorage(), true);
  storage.setItem('test-session', 'opaque-session-value');
  assert.equal(loadPage().supportsLocalStorage(), true);
  assert.equal(storage.getItem('test-session'), 'opaque-session-value');
  assert.deepEqual([...values.keys()], ['test-session']);
});
