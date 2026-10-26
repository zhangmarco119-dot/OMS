const MAX_WIRE_BYTES = 4 * 1024 * 1024 + 128 * 1024;
exports.createHttpHandler = proxy => async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  const send = (status, value) => { response.writeHead(status); response.end(JSON.stringify(value)); };
  if (request.method !== 'POST' || request.url.split('?')[0] !== '/proxy') {
    request.resume(); return send(404, { error: 'NOT_FOUND' });
  }
  // These headers are supplied/overwritten by WeChat's HTTP-function gateway.
  // Do not create a public unauthenticated HTTP route to this function.
  const identity = { APPID: request.headers['x-wx-appid'], OPENID: request.headers['x-wx-openid'] };
  let length = 0;
  const chunks = [];
  try {
    for await (const chunk of request) {
      length += chunk.length;
      if (length > MAX_WIRE_BYTES) return send(413, { error: 'PAYLOAD_TOO_LARGE' });
      chunks.push(chunk);
    }
    let event;
    try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return send(400, { error: 'INVALID_JSON' }); }
    send(200, await proxy(event, identity));
  } catch {
    if (!response.headersSent) send(502, { error: 'GATEWAY_UNAVAILABLE' });
  }
};
