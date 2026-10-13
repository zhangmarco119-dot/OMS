// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {proxyDevelopmentBackend} from '../public/_worker.js';

const env = {STOREHUB_DEV_BACKEND_ORIGIN:'https://test-connection.trycloudflare.com',ASSETS:{fetch:vi.fn(()=>new Response('asset'))}};
describe('development-only API proxy',()=>{
  it('forwards authenticated requests without losing body, query or headers',async()=>{
    const fetcher=vi.fn(async(request)=>{
      expect(request.url).toBe('https://test-connection.trycloudflare.com/rest/v1/products?select=id');
      expect(request.headers.get('authorization')).toBe('Bearer session');
      expect(await request.text()).toBe('{"name":"test"}');
      return new Response('ok');
    });
    const response=await proxyDevelopmentBackend(new Request('https://oms-store-development.pages.dev/backend/rest/v1/products?select=id',{method:'POST',headers:{authorization:'Bearer session'},body:'{"name":"test"}'}),env,fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never falls back to development for production or proxies administrative routes',async()=>{
    const fetcher=vi.fn();
    expect((await proxyDevelopmentBackend(new Request('https://oms-store-management.pages.dev/backend/rest/v1/products'),env,fetcher)).status).toBe(503);
    for(const path of ['/pg/query','/mcp','/rest-admin/v1/config','/unknown/v1/','/realtime/v1/api/tenants']) {
      expect((await proxyDevelopmentBackend(new Request(`https://oms-store-development.pages.dev/backend${path}`),env,fetcher)).status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses an independent production binding without mixing development data',async()=>{
    const fetcher=vi.fn(async request=>{expect(request.url).toBe('https://production-only.trycloudflare.com/rest/v1/products');return new Response('ok');});
    expect((await proxyDevelopmentBackend(new Request('https://oms-store-management.pages.dev/backend/rest/v1/products'),{...env,STOREHUB_PROD_BACKEND_ORIGIN:'https://production-only.trycloudflare.com'},fetcher)).status).toBe(200);
  });
  it('fails closed for missing or untrusted upstreams and connection failures',async()=>{
    const request=new Request('https://oms-store-development.pages.dev/backend/auth/v1/health');
    expect((await proxyDevelopmentBackend(request,{...env,STOREHUB_DEV_BACKEND_ORIGIN:'http://localhost:54321'})).status).toBe(503);
    expect((await proxyDevelopmentBackend(request,env,async()=>{throw new Error('offline');})).status).toBe(502);
  });
  it('preserves the WebSocket upgrade response itself',async()=>{
    const upgrade={status:101};
    expect(await proxyDevelopmentBackend(new Request('https://oms-store-development.pages.dev/backend/realtime/v1/websocket'),env,async()=>upgrade)).toBe(upgrade);
  });
});
