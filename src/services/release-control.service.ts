import { currentRelease, type StoreHubReleaseManifest } from '../config/release';
import { supabase } from '../lib/supabase';

export interface SystemReleasePolicy {
  activeRelease: string;
  allowedReleases: string[];
  checkIntervalSeconds: number;
  enforcementMode: 'off' | 'warn' | 'block';
  message: string;
  minimumDatabaseContract: number;
}

export interface ReleaseUpdateRequirement {
  message: string;
  serverBuildId?: string;
  title: string;
}

const isManifest = (value: unknown): value is StoreHubReleaseManifest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoreHubReleaseManifest>;
  return candidate.schema === 1
    && typeof candidate.buildId === 'string'
    && typeof candidate.version === 'string'
    && typeof candidate.databaseContract === 'number';
};

const parsePolicy = (value: unknown): SystemReleasePolicy | null => {
  if (!value || typeof value !== 'object') return null;
  const policy = value as Record<string, unknown>;
  const enforcementMode = policy.enforcementMode;
  if (enforcementMode !== 'off' && enforcementMode !== 'warn' && enforcementMode !== 'block') return null;
  return {
    activeRelease: typeof policy.activeRelease === 'string' ? policy.activeRelease : '',
    allowedReleases: Array.isArray(policy.allowedReleases)
      ? policy.allowedReleases.filter((item): item is string => typeof item === 'string')
      : [],
    checkIntervalSeconds: typeof policy.checkIntervalSeconds === 'number' ? policy.checkIntervalSeconds : 60,
    enforcementMode,
    message: typeof policy.message === 'string' ? policy.message : '',
    minimumDatabaseContract: typeof policy.minimumDatabaseContract === 'number'
      ? policy.minimumDatabaseContract
      : 1,
  };
};

export async function fetchCurrentReleaseManifest(fetcher: typeof fetch = fetch): Promise<StoreHubReleaseManifest | null> {
  try {
    const url = new URL('/version.json', window.location.origin);
    url.searchParams.set('_storehub_check', String(Date.now()));
    const response = await fetcher(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const manifest: unknown = await response.json();
    return isManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

export async function fetchSystemReleasePolicy(): Promise<SystemReleasePolicy | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_system_release_policy');
  if (error) return null;
  return parsePolicy(data);
}

export function determineRequiredUpdate({ manifest, policy }: {
  manifest: StoreHubReleaseManifest | null;
  policy: SystemReleasePolicy | null;
}): ReleaseUpdateRequirement | null {
  if (manifest && manifest.buildId !== currentRelease.buildId) {
    return {
      message: '系统已发布新的页面版本。为避免继续使用旧页面提交数据，请立即更新后继续操作。',
      serverBuildId: manifest.buildId,
      title: '系统需要更新',
    };
  }

  if (policy?.enforcementMode === 'block') {
    const releaseAllowed = policy.allowedReleases.includes(currentRelease.version);
    const contractAllowed = currentRelease.databaseContract >= policy.minimumDatabaseContract;
    if (!releaseAllowed || !contractAllowed) {
      return {
        message: policy.message || '当前页面版本已经停止使用，请立即更新后继续操作。',
        serverBuildId: manifest?.buildId,
        title: '当前版本已停用',
      };
    }
  }
  return null;
}

export function createReloadUrl(buildId?: string, location: Location = window.location): string {
  const url = new URL(location.href);
  url.searchParams.set('_storehub_release', buildId || String(Date.now()));
  return url.toString();
}
