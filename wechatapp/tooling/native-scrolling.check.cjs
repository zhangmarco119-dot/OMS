const test = require('node:test'), assert = require('node:assert/strict');
const { installNativeScrolling } = require('./native-scrolling.cjs');
test('route scroll reset and smooth scrolling call the native page API', () => {
  const window = {}, document = { documentElement: { $$scrollTop: 480 } }, calls = [];
  installNativeScrolling(window, document, { pageScrollTo: args => calls.push(args) });
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  assert.deepEqual(calls.pop(), { scrollTop: 0, duration: 0 });
  window.scrollTo({ top: 200, behavior: 'smooth' });
  assert.deepEqual(calls.pop(), { scrollTop: 200, duration: 300 });
  assert.equal(window.scrollY, 200);
  window.scrollBy(0, 50);
  assert.equal(window.pageYOffset, 250);
  window.scrollTo(0, -20);
  assert.equal(window.scrollY, 0);
});
