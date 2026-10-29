const test=require('node:test'),assert=require('node:assert/strict');
const {Blob}=require('node:buffer');
const {installNativeCanvas}=require('./native-canvas.cjs');
test('shared payroll and tax-card renderers receive a synchronous real native canvas context and PNG bytes',async()=>{
  const context={fillRect(){}},native={width:300,height:150,getContext:type=>type==='2d'?context:null,toDataURL:()=>`data:image/png;base64,${Buffer.from([137,80,78,71]).toString('base64')}`};
  const document={createElement:()=>({})};
  installNativeCanvas({Blob},document,{createOffscreenCanvas:()=>native,base64ToArrayBuffer:value=>Uint8Array.from(Buffer.from(value,'base64')).buffer});
  const canvas=document.createElement('canvas');canvas.width=1500;canvas.height=2200;
  assert.equal(native.width,1500);assert.equal(native.height,2200);assert.equal(canvas.getContext('2d'),context);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  assert.equal(blob.type,'image/png');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new Uint8Array([137,80,78,71]));
});
