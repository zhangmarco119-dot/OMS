const MAX_BYTES = 3 * 1024 * 1024;
const origins = {
  development: 'https://oms-store-development.pages.dev',
  production: 'https://oms-store-management.pages.dev',
};
const requestHeaders = new Set(['authorization','apikey','content-type','accept','prefer','range','range-unit','if-none-match','x-client-info','x-upsert','cache-control','x-storehub-contract','x-storehub-release']);
const responseHeaders = new Set(['content-type','content-range','range-unit','etag','last-modified','x-total-count']);
const allowedFunctions = new Set(['account-login','admin-users','dingtalk-attendance','pospal-sales','qmai-sales','task-template-images','ai-review']);
const errorResponse = (status, code, message) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, encoding: 'utf8', body: JSON.stringify({code,message}) });
function resolveTarget(raw, origin) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 24000 || /[\\\u0000-\u0020#]/.test(raw)) throw new Error('PATH');
  const rawPath = raw.split('?')[0];
  let decoded = rawPath;
  for (let i=0;i<3;i++) {
    const next = decodeURIComponent(decoded);
    if (/[\\\u0000-\u0020]/.test(next) || next.split('/').some(part => part === '.' || part === '..')) throw new Error('PATH');
    if (next === decoded) break;
    decoded = next;
  }
  const url = new URL(raw, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('PATH');
  if (url.pathname === '/version.json' && !url.search) return url;
  if (!/^\/backend\/(auth|rest|storage|functions)\/v1(?:\/|$)/.test(decoded)) throw new Error('PATH');
  if (/^\/backend\/auth\/v1\/admin(?:\/|$)/.test(decoded)) throw new Error('PATH');
  if (decoded.startsWith('/backend/functions/v1/') && !allowedFunctions.has(decoded.split('/')[4])) throw new Error('PATH');
  if (decoded.startsWith('/backend/storage/v1/') && !/^\/backend\/storage\/v1\/(object|render\/image)(?:\/|$)/.test(decoded)) throw new Error('PATH');
  return url;
}
exports.createProxy = ({ target, fetcher, timeoutMs = 30000, maxBytes = MAX_BYTES }) => {
  if (!target || origins[target.environment] !== target.origin || target.appid !== 'wxa11bc5cac53d2291') throw new Error('Invalid deployment target');
  return async (event, identity) => {
    if (!identity?.OPENID || identity.APPID !== target.appid) return errorResponse(403,'MINIPROGRAM_REQUIRED','请从授权的小程序访问。');
    if (!event || typeof event !== 'object') return errorResponse(400,'INVALID_REQUEST','请求格式不正确。');
    const method = String(event.method || 'GET').toUpperCase();
    if (!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method)) return errorResponse(405,'METHOD_NOT_ALLOWED','请求方法不受支持。');
    let url, body, headers;
    try {
      url = resolveTarget(event.path, target.origin);
      if (url.pathname === '/version.json' && method !== 'GET') throw new Error('PATH');
      if (event.body !== undefined && typeof event.body !== 'string') throw new Error('BODY');
      if (event.encoding && !['utf8','base64'].includes(event.encoding)) throw new Error('BODY');
      if (event.encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body || '')) throw new Error('BODY');
      body = event.body === undefined ? undefined : Buffer.from(event.body, event.encoding === 'base64' ? 'base64' : 'utf8');
      if (body && ['GET','HEAD'].includes(method)) throw new Error('BODY');
      if (body?.length > maxBytes) return errorResponse(413,'PAYLOAD_TOO_LARGE','文件超过小程序单次传输上限，请压缩后重试。');
      headers = {};
      for (const [name,value] of Object.entries(event.headers || {})) {
        if (requestHeaders.has(name.toLowerCase()) && typeof value === 'string' && value.length <= 24000 && !/[\r\n\0]/.test(value)) headers[name.toLowerCase()] = value;
      }
    } catch {
      return errorResponse(400,'INVALID_REQUEST','请求地址或内容格式不正确。');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetcher(url.href, {method,headers,body,redirect:'manual',signal:controller.signal});
      // Never follow a redirect to an origin supplied by an upstream response.
      if (upstream.status >= 300 && upstream.status < 400) return errorResponse(502,'UNEXPECTED_REDIRECT','服务连接地址发生变化，请联系管理员。');
      const bytes = [];
      let length = 0;
      if (upstream.body) for await (const chunk of upstream.body) {
        length += chunk.length;
        if (length > maxBytes) {
          controller.abort();
          return errorResponse(413,'RESPONSE_TOO_LARGE','返回文件超过小程序单次传输上限，请缩小范围后重试。');
        }
        bytes.push(chunk);
      }
      const resultHeaders = {};
      for (const [name,value] of upstream.headers) if (responseHeaders.has(name)) resultHeaders[name] = value;
      const content = Buffer.concat(bytes);
      const text = /(?:application\/(?:[a-z0-9.+-]*json|xml)|text\/)/i.test(resultHeaders['content-type'] || '');
      return {status:upstream.status,headers:resultHeaders,encoding:text?'utf8':'base64',body:content.toString(text?'utf8':'base64')};
    } catch {
      return errorResponse(controller.signal.aborted?504:502,controller.signal.aborted?'GATEWAY_TIMEOUT':'BACKEND_UNAVAILABLE','服务连接暂时异常，请稍后重试；已保存的数据不受影响。');
    } finally { clearTimeout(timer); }
  };
};
