const test=require('node:test'),assert=require('node:assert/strict');
const {TextEncoder,TextDecoder}=require('./native-utf8.cjs');
test('large business JSON roundtrips in linear work without shifting input arrays',()=>{
  const text=JSON.stringify(Array.from({length:3000},(_,i)=>({id:i,name:'门店任务🙂',note:'处理中'.repeat(20)})));
  const original=Array.prototype.shift;
  Array.prototype.shift=function(){throw new Error('Quadratic input consumption');};
  let bytes,decoded;
  try {bytes=new TextEncoder().encode(text);decoded=new TextDecoder().decode(bytes);}finally{Array.prototype.shift=original;}
  assert.equal(decoded,text);assert.deepEqual(Buffer.from(bytes),Buffer.from(text));
});
test('UTF-8 matches standard replacement, view offsets, BOM, streaming and encodeInto semantics',()=>{
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  for(const text of ['', '中文🙂', '\ud800a\udc00', '\ufeff文字'])assert.deepEqual(Buffer.from(encoder.encode(text)),Buffer.from(text));
  for(const bytes of [[0xe2,0x82,65],[0xe0,0x80,0x80],[0xf4,0x90,0x80,0x80],[0xed,0xa0,0x80],[0xe2,0x82]])assert.equal(decoder.decode(new Uint8Array(bytes)),new globalThis.TextDecoder().decode(new Uint8Array(bytes)));
  assert.equal(decoder.decode(encoder.encode('\ufeff中文')),'中文');
  assert.equal(new TextDecoder('utf8',{ignoreBOM:true}).decode(encoder.encode('\ufeffa')),'\ufeffa');
  assert.throws(()=>new TextDecoder('utf8',{fatal:true}).decode(new Uint8Array([255])),TypeError);
  assert.equal(decoder.decode(new Uint8Array([0xf0,0x9f]),{stream:true}),'');
  assert.equal(decoder.decode(new Uint8Array([0x99,0x82])),'🙂');
  const destination=new Uint8Array(4);assert.deepEqual(encoder.encodeInto('🙂a',destination),{read:2,written:4});
  const offset=new Uint8Array([0,0xe4,0xb8,0xad,0]);assert.equal(decoder.decode(offset.subarray(1,4)),'中');
});
