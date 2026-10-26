const test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),path=require('node:path'),vm=require('node:vm');
const rootRequire=createRequire(path.join(__dirname,'../../package.json'));
const esbuild=createRequire(rootRequire.resolve('vite'))('esbuild');
test('native JSX adapter maps all browser date controls and expandable details',async()=>{
  const built=await esbuild.build({entryPoints:[path.join(__dirname,'native-jsx-runtime.ts')],bundle:true,write:false,format:'cjs',platform:'node',external:['react','storehub-original-jsx-runtime']});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:name=>name==='storehub-original-jsx-runtime'?rootRequire('react/jsx-runtime'):rootRequire(name)});
  const runtime=module.exports;
  for(const type of ['date','month','time','datetime-local'])assert.equal(typeof runtime.jsx('input',{type}).type,'object');
  assert.equal(runtime.jsx('input',{type:'text'}).type,'input');
  assert.equal(runtime.jsx('select',{}).type,'select');
  assert.equal(typeof runtime.jsx('details',{}).type,'function');
  const rows=Array.from({length:45},(_,index)=>runtime.jsx('article',{children:'row'},String(index)));
  const list=runtime.jsxs('section',{children:rows});
  assert.equal(typeof list.props.children.type,'function');
  assert.equal(list.props.children.props.items.length,45);
  const options=Array.from({length:45},(_,index)=>runtime.jsx('option',{value:index},String(index)));
  assert.equal(runtime.jsx('select',{children:options}).props.children.length,45);
});
test('picker changes reach business state, details expand, and every paged record remains accessible',async()=>{
  const built=await esbuild.build({entryPoints:[path.join(__dirname,'native-controls.tsx')],bundle:true,write:false,format:'cjs',platform:'node',external:['react']});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:rootRequire});
  const {NativeDateInput,NativeDetails,NativePagedChildren}=module.exports;
  const {JSDOM}=rootRequire('jsdom'),React=rootRequire('react'),{createRoot}=rootRequire('react-dom/client');
  const dom=new JSDOM('<div id="test"></div>',{url:'https://test.example'});
  const document=dom.window.document;
  const previous={window:global.window,document:global.document,IS_REACT_ACT_ENVIRONMENT:global.IS_REACT_ACT_ENVIRONMENT};
  Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const root=createRoot(document.getElementById('test'));
  try{
    let changed;
    await React.act(async()=>root.render(React.createElement(NativeDateInput,{type:'month',value:'2026-10',onChange:event=>changed=event.target.value})));
    await React.act(async()=>document.querySelector('wx-picker').dispatchEvent(new dom.window.CustomEvent('change',{detail:{value:'2026-11'}})));
    assert.equal(changed,'2026-11');assert.equal(document.querySelector('wx-picker').getAttribute('fields'),'month');
    await React.act(async()=>root.render(React.createElement(NativeDetails,null,React.createElement('summary',null,'高级选项'),React.createElement('p',null,'明细内容'))));
    assert.equal(document.querySelector('p'),null);
    await React.act(async()=>document.querySelector('button').click());assert.equal(document.querySelector('p').textContent,'明细内容');
    const items=Array.from({length:45},(_,index)=>React.createElement('article',{key:String(index)},`记录${index}`));
    await React.act(async()=>root.render(React.createElement(NativePagedChildren,{items})));
    assert.equal(document.querySelectorAll('article').length,20);
    await React.act(async()=>document.querySelectorAll('button')[1].click());assert.equal(document.querySelector('article').textContent,'记录20');
    await React.act(async()=>document.querySelectorAll('button')[1].click());assert.equal(document.querySelectorAll('article').length,5);assert.equal(document.querySelectorAll('article')[4].textContent,'记录44');
  }finally{await React.act(async()=>root.unmount());Object.assign(global,previous);dom.window.close();}
});
