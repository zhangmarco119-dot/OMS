const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {transformNativeSource}=require('./native-source-transform.cjs');
const {installNativeDialogs}=require('./native-dialogs.cjs');
test('cancelled native dialogs stop writes, including synchronous JSX event handlers',async()=>{
  const input='const change = () => { if(!window.confirm("change")) return; save(); };';
  const transformed=transformNativeSource(input,'handler.tsx');
  assert.match(transformed,/async/);assert.match(transformed,/await window.__storehubConfirm/);
  let writes=0;
  for(const confirmed of [false,true]){
    const handler=vm.runInNewContext(transformed+';change',{window:{__storehubConfirm:async()=>confirmed},save:()=>writes++});
    await handler();assert.equal(writes,confirmed?1:0);
  }
  const jsx=transformNativeSource('const view=<button onClick={() => {if(window.confirm("go")) save();}}>go</button>;','page.tsx');
  assert.match(jsx,/onClick=\{async/);
});
test('native confirmation requests are sequential and failures cancel the operation',async()=>{
  const window={},calls=[];
  installNativeDialogs(window,{showModal:options=>calls.push(options)});
  const a=window.__storehubConfirm('first'),b=window.__storehubConfirm('second');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
  calls[0].success({confirm:false});assert.equal(await a,false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);
  calls[1].fail({});assert.equal(await b,false);
});
