import { Blob, Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve('android/app/src/main/assets/downloads.js'), 'utf8');
function harness(blob, bridge = true) {
  const messages = [];
  const normalClick = vi.fn();
  class Anchor {
    constructor(href, download = '') { this.href = href; this.download = download; }
    hasAttribute(name) { return name === 'download'; }
    click() { normalClick(); }
  }
  const fetch = vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(blob) }));
  const listener = vi.fn();
  const window = bridge ? { StoreHubDownloads: { postMessage: value => messages.push(JSON.parse(value)) } } : {};
  const context = vm.createContext({ window, HTMLAnchorElement: Anchor, document: { addEventListener: listener }, fetch, Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64') });
  vm.runInContext(source, context);
  return { Anchor, messages, normalClick, fetch, listener, context };
}
describe('Android file export compatibility', () => {
  it('captures the blob before callers revoke its URL and preserves multiple chunks exactly', async () => {
    const bytes = Buffer.alloc(140000); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const h = harness(new Blob([bytes], { type: 'application/octet-stream' }));
    new h.Anchor('blob:export', '报表.xlsx').click();
    expect(h.fetch).toHaveBeenCalledWith('blob:export');
    await vi.waitFor(() => expect(h.messages.at(-1)?.action).toBe('finish'));
    expect(h.messages[0]).toEqual({ action: 'start', name: '报表.xlsx', mime: 'application/octet-stream', size: bytes.length });
    expect(Buffer.concat(h.messages.filter(value => value.action === 'chunk').map(value => Buffer.from(value.data, 'base64')))).toEqual(bytes);
    expect(h.normalClick).not.toHaveBeenCalled();
  });
  it('preserves browser behavior without the native listener and normal HTTPS links inside Android', () => {
    const browser = harness(new Blob(), false);
    new browser.Anchor('blob:export').click();
    expect(browser.normalClick).toHaveBeenCalledOnce();
    expect(browser.listener).not.toHaveBeenCalled();
    const android = harness(new Blob());
    new android.Anchor('https://example.com/report').click();
    expect(android.normalClick).toHaveBeenCalledOnce();
    expect(android.fetch).not.toHaveBeenCalled();
  });
  it('reports an oversized file and does not start a partial native export', async () => {
    const h = harness({ size: 50 * 1024 * 1024 + 1 });
    new h.Anchor('blob:large').click();
    await vi.waitFor(() => expect(h.messages.at(-1)?.action).toBe('error'));
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0].message).toContain('50MB');
  });
  it('installs only once and prevents overlapping transfers', async () => {
    const h = harness(new Blob(['one']));
    vm.runInContext(source, h.context);
    expect(h.listener).toHaveBeenCalledOnce();
    new h.Anchor('blob:one').click(); new h.Anchor('blob:two').click();
    await vi.waitFor(() => expect(h.messages.at(-1)?.action).toBe('finish'));
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.messages.some(value => value.action === 'error')).toBe(true);
  });
});
