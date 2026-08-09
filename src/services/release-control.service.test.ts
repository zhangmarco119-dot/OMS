import { createReleaseAwareFetch, currentRelease, RELEASE_UPDATE_REQUIRED_EVENT } from '../config/release';
import {
  createReloadUrl,
  determineRequiredUpdate,
  fetchCurrentReleaseManifest,
  type SystemReleasePolicy,
} from './release-control.service';

const policy = (overrides: Partial<SystemReleasePolicy> = {}): SystemReleasePolicy => ({
  activeRelease: currentRelease.version,
  allowedReleases: [currentRelease.version],
  checkIntervalSeconds: 60,
  enforcementMode: 'off',
  message: '',
  minimumDatabaseContract: 1,
  ...overrides,
});

describe('release control', () => {
  it('requires refresh when the deployed build differs in either direction', () => {
    const requirement = determineRequiredUpdate({
      manifest: { ...currentRelease, buildId: '2.4.2+rollback', schema: 1, version: '2.4.2' },
      policy: policy(),
    });
    expect(requirement?.serverBuildId).toBe('2.4.2+rollback');
  });

  it('blocks a release omitted from the exact allow list', () => {
    const requirement = determineRequiredUpdate({
      manifest: { ...currentRelease, schema: 1 },
      policy: policy({ allowedReleases: ['2.4.2'], enforcementMode: 'block' }),
    });
    expect(requirement?.title).toBe('当前版本已停用');
  });

  it('does not block while the bootstrap policy is off', () => {
    expect(determineRequiredUpdate({
      manifest: { ...currentRelease, schema: 1 },
      policy: policy({ allowedReleases: ['1.0.0'], enforcementMode: 'off' }),
    })).toBeNull();
  });

  it('ignores a SPA fallback response instead of treating it as a manifest', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    }));
    await expect(fetchCurrentReleaseManifest(fetcher)).resolves.toBeNull();
  });

  it('preserves the current route when creating a cache-busting reload URL', () => {
    const location = { href: 'https://example.com/app/sops?category=酸奶碗#step' } as Location;
    const result = new URL(createReloadUrl('2.4.2+rollback', location));
    expect(result.pathname).toBe('/app/sops');
    expect(result.searchParams.get('category')).toBe('酸奶碗');
    expect(result.searchParams.get('_storehub_release')).toBe('2.4.2+rollback');
    expect(result.hash).toBe('#step');
  });

  it('raises an immediate update event when the database rejects an old client write', async () => {
    const listener = vi.fn();
    window.addEventListener(RELEASE_UPDATE_REQUIRED_EVENT, listener);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      hint: 'STOREHUB_CLIENT_UPDATE_REQUIRED',
      message: '请更新',
    }), {
      headers: { 'content-type': 'application/json' },
      status: 400,
    }));
    const response = await createReleaseAwareFetch(fetcher)('https://example.com/rest/v1/rpc/save');
    expect(response.status).toBe(400);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(RELEASE_UPDATE_REQUIRED_EVENT, listener);
  });

  it('aborts a stalled task-image storage request instead of waiting forever', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    await expect(createReleaseAwareFetch(fetcher as typeof fetch, { taskImageUploadTimeoutMs: 5 })(
      'https://example.supabase.co/storage/v1/object/v2-task-images/store/task/item/image.jpg',
      { method: 'POST' },
    )).rejects.toThrow('任务图片上传超时');
  });
});
