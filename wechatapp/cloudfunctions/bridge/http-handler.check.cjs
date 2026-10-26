const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHttpHandler } = require('./http-handler.cjs');
async function withServer(proxy, run) {
  const server = http.createServer(createHttpHandler(proxy));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('HTTP envelope takes WeChat identity from gateway headers rather than body fields', async () => {
  await withServer(async (event, identity) => {
    assert.equal(event.path, '/version.json');
    assert.deepEqual(identity, { APPID: 'verified-app', OPENID: 'verified-user' });
    return { status: 200, headers: {}, encoding: 'base64', body: 'AP8=' };
  }, async origin => {
    const response = await fetch(origin + '/proxy', { method: 'POST', headers: { 'x-wx-appid': 'verified-app', 'x-wx-openid': 'verified-user' }, body: JSON.stringify({ path: '/version.json', identity: { APPID: 'forged' } }) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).body, 'AP8=');
  });
});
test('HTTP envelope rejects wrong routes and malformed JSON without calling backend', async () => {
  await withServer(() => { throw new Error('Backend must not be contacted'); }, async origin => {
    assert.equal((await fetch(origin + '/proxy')).status, 404);
    assert.equal((await fetch(origin + '/other', { method: 'POST' })).status, 404);
    const response = await fetch(origin + '/proxy', { method: 'POST', body: 'malformed-secret' });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /malformed-secret/);
  });
});
