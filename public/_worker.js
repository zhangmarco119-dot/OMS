const developmentHost = 'oms-store-development.pages.dev';
const apiPath = /^\/(?:auth|rest|storage|functions|realtime)\/v1(?:\/|$)/;

// The development API is the only tunneled surface. Studio, pg-meta, SQL,
// database ports and PostgREST's administration port are never forwarded.
export async function proxyDevelopmentBackend(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.hostname !== developmentHost || !url.pathname.startsWith('/backend/')) {
    return env.ASSETS.fetch(request);
  }
  const path = url.pathname.slice('/backend'.length);
  if (!apiPath.test(path) || /%2f|%5c|\.\./i.test(path)) {
    return new Response('Not found', {status:404});
  }
  let origin;
  try {
    origin = new URL(env.STOREHUB_DEV_BACKEND_ORIGIN);
    if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(origin.hostname)
      || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || origin.port) throw new Error('Invalid origin');
  } catch {
    return new Response('Development backend is unavailable', {status:503,headers:{'Cache-Control':'no-store'}});
  }
  const target = new URL(`${path}${url.search}`, origin);
  try {
    const upstream = await fetcher(new Request(target.href, request), {redirect:'manual'});
    // Preserve Cloudflare's WebSocket response object and upgrade connection.
    if (upstream.status === 101) return upstream;
    const headers = new Headers(upstream.headers);
    headers.set('Cache-Control','no-store');
    return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers});
  } catch {
    return new Response('Development backend connection failed', {status:502,headers:{'Cache-Control':'no-store'}});
  }
}

export default {fetch(request,env) { return proxyDevelopmentBackend(request,env); }};
