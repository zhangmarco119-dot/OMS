const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { patchSubmitBubbling } = require('./kbone-event-patch.cjs');
global.wx = {getSystemInfoSync:()=>({})};
const {EventTarget,Event} = require('miniprogram-render').$$adapter;
const source = fs.readFileSync(path.join(__dirname, 'node_modules/miniprogram-element/dist/base.js'), 'utf8');
const patched = patchSubmitBubbling(source);
const method = patched.match(/callSimpleEvent\(e,t,a\)\{.+?\}\)\)\}/)[0];
const callSimpleEvent = new Function('s', 'l', 'return ({' + method + '}).callSimpleEvent')(EventTarget, Event);
function node(parent, tag) {
  const target = new EventTarget();
  target.tagName = tag; target.parentNode = parent;
  target.ownerDocument = { defaultView: { performance: { now: () => Date.now() } } };
  return target;
}
test('submit, reset and input change reach React delegated bubble listeners exactly once', () => {
  for (const name of ['submit', 'reset', 'change']) {
    const root = node(null, 'DIV'), form = node(root, 'FORM'), seen = [];
    root.addEventListener(name, event => { seen.push('capture'); assert.equal(event.target, form); }, true);
    root.addEventListener(name, event => { seen.push('bubble'); assert.equal(event.target, form); });
    callSimpleEvent.call({}, name, { detail: {} }, form);
    assert.deepEqual(seen, ['capture', 'bubble']);
  }
});
test('events which should not bubble keep their original behavior', () => {
  const root = node(null, 'DIV'), input = node(root, 'INPUT'), seen = [];
  root.addEventListener('focus', () => seen.push('capture'), true);
  root.addEventListener('focus', () => seen.push('bubble'));
  callSimpleEvent.call({}, 'focus', { detail: {} }, input);
  assert.deepEqual(seen, ['capture']);
  assert.throws(() => patchSubmitBubbling('changed upstream module'), /adapter changed/);
});
