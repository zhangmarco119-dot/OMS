const test = require('node:test'), assert = require('node:assert/strict');
global.wx={getSystemInfoSync:()=>({}),getStorageInfoSync:()=>({keys:[]})};
const runtime=require('miniprogram-render');
const { extraStyleList } = require('./native-styles.cjs');
test('native style serialization retains navigation columns and image aspect ratios', () => {
  const page=runtime.createPage('style-test',{origin:'https://test.example',optimization:{},runtime:{extraStyleList},window:{}});
  const style = page.document.createElement('div').style;
  style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
  style.aspectRatio = '1 / 1';
  style.objectPosition = '50% 50%';
  assert.match(style.cssText, /grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(style.cssText, /aspect-ratio:1 \/ 1/);
  assert.match(style.cssText, /object-position:50% 50%/);
});
