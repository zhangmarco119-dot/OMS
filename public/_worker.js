const backendBindings = {
  'oms-store-development.pages.dev': 'STOREHUB_DEV_BACKEND_ORIGIN',
  'oms-store-management.pages.dev': 'STOREHUB_PROD_BACKEND_ORIGIN',
};
const apiPath = /^\/(?:auth|rest|storage|functions|realtime)\/v1(?:\/|$)/;

// Each site uses its own backend binding. Studio, pg-meta, SQL,
// database ports and PostgREST's administration port are never forwarded.
export async function proxyDevelopmentBackend(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  const binding = backendBindings[url.hostname];
  if (!binding || !url.pathname.startsWith('/backend/')) {
    return env.ASSETS.fetch(request);
  }
  const path = url.pathname.slice('/backend'.length);
  if (!apiPath.test(path) || /%2f|%5c|\.\./i.test(path)
    || (path.startsWith('/realtime/v1/') && !['/realtime/v1/websocket', '/realtime/v1/api/broadcast'].includes(path))) {
    return new Response('Not found', {status:404});
  }
  let origin;
  try {
    origin = new URL(env[binding]);
    if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(origin.hostname)
      || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || origin.port) throw new Error('Invalid origin');
  } catch {
    return new Response('Backend is unavailable', {status:503,headers:{'Cache-Control':'no-store'}});
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
    return new Response('Backend connection failed', {status:502,headers:{'Cache-Control':'no-store'}});
  }
}

export default {fetch(request,env) { return proxyDevelopmentBackend(request,env); }};
