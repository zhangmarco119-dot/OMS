const test = require('node:test');
const assert = require('node:assert/strict');
const {createProxy} = require('./proxy.cjs');
const target = {environment:'development',origin:'https://oms-store-development.pages.dev',appid:'wxa11bc5cac53d2291'};
const identity = {APPID:target.appid,OPENID:'local-test-identity'};
test('rejects missing or different mini program identity before contacting backend',async()=>{
  const proxy = createProxy({target,fetcher:()=>{throw new Error('Must not request');}});
  assert.equal((await proxy({path:'/backend/rest/v1/products'},{})).status,403);
  assert.equal((await proxy({path:'/backend/rest/v1/products'},{...identity,APPID:'wxwrong'})).status,403);
});
test('rejects arbitrary hosts, traversal, admin and unrelated functions',async()=>{
  const proxy = createProxy({target,fetcher:()=>{throw new Error('Must not request');}});
  for (const path of ['https://other.example/backend/rest/v1/products','//other.example/backend/rest/v1/products','/backend/rest/v1/../../auth/v1/admin','/backend/rest/v1/%252e%252e/auth','/backend/rest/v1/%5cadmin','/backend/auth/v1/admin/users','/backend/functions/v1/arbitrary-function','/backend/storage/v1/bucket','/backend/realtime/v1/websocket','/studio']) assert.equal((await proxy({path},identity)).status,400,path);
});
test('retains user auth, contract and pagination, blocks origin-token/header injection',async()=>{
  const proxy = createProxy({target,fetcher:async(url,init)=>{
    assert.equal(url,target.origin+'/backend/rest/v1/products?select=id');
    assert.deepEqual(init.headers,{authorization:'Bearer test-user',apikey:'public-test-key','x-storehub-contract':'1',range:'0-19'});
    assert.equal(init.redirect,'manual');
    return new Response('[{"id":"one"}]',{status:206,headers:{'content-type':'application/json','content-range':'0-0/1','set-cookie':'must-not-forward'}});
  }});
  const result = await proxy({path:'/backend/rest/v1/products?select=id',headers:{Authorization:'Bearer test-user',apikey:'public-test-key','X-StoreHub-Contract':'1',Range:'0-19','X-StoreHub-Origin-Token':'forged',host:'evil.example','X-Client-Info':'unsafe\r\nvalue'}},identity);
  assert.equal(result.status,206); assert.equal(result.headers['content-range'],'0-0/1');assert.equal(result.headers['set-cookie'],undefined);assert.deepEqual(JSON.parse(result.body),[{id:'one'}]);
});
test('uploads and returns actual binary bytes without JSON/string corruption',async()=>{
  const data=Buffer.from([0,255,3,128]);
  const proxy=createProxy({target,fetcher:async(url,init)=>{assert.deepEqual(init.body,data);return new Response(data,{headers:{'content-type':'image/png'}});}});
  const result=await proxy({method:'POST',path:'/backend/storage/v1/object/v2-task-images/test.png',encoding:'base64',body:data.toString('base64')},identity);
  assert.equal(result.encoding,'base64');assert.deepEqual(Buffer.from(result.body,'base64'),data);
});
test('enforces request and response limits, blocks redirect before content is read',async()=>{
  let called=false;
  const proxy=createProxy({target,maxBytes:4,fetcher:async()=>{called=true;return new Response('12345');}});
  assert.equal((await proxy({method:'POST',path:'/backend/rest/v1/products',body:'12345'},identity)).status,413);assert.equal(called,false);
  assert.equal((await proxy({path:'/backend/rest/v1/products'},identity)).status,413);
  const redirect=createProxy({target,fetcher:async()=>new Response(null,{status:302,headers:{location:'http://localhost/admin'}})});
  assert.equal((await redirect({path:'/backend/rest/v1/products'},identity)).status,502);
});
test('sanitizes failures so passwords, tokens and upstream details cannot enter app errors',async()=>{
  const proxy=createProxy({target,fetcher:async()=>{throw new Error('secret-user-password internal-host');}});
  const result=await proxy({path:'/backend/functions/v1/account-login',method:'POST',body:'{"password":"secret-user-password"}'},identity);
  assert.equal(result.status,502);assert.doesNotMatch(result.body,/secret-user-password|internal-host/);
});
test('rejects a production destination inside a development function deployment',()=>{
  assert.throws(()=>createProxy({target:{...target,origin:'https://oms-store-management.pages.dev'},fetcher:fetch}),/Invalid deployment target/);
});
