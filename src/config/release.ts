export interface StoreHubReleaseMetadata {
  buildId: string;
  builtAt: string;
  databaseContract: number;
  environment: 'development' | 'production';
  version: string;
}

export interface StoreHubReleaseManifest extends StoreHubReleaseMetadata {
  schema: 1;
}

export const currentRelease: StoreHubReleaseMetadata = __STOREHUB_RELEASE__;

export const releaseRequestHeaders = {
  'x-storehub-contract': String(currentRelease.databaseContract),
  'x-storehub-release': currentRelease.version,
};

export const RELEASE_UPDATE_REQUIRED_EVENT = 'storehub:release-update-required';

export const createReleaseAwareFetch = (fetcher: typeof fetch = fetch): typeof fetch => async (input, init) => {
  const response = await fetcher(input, init);
  if (!response.ok && typeof window !== 'undefined') {
    try {
      const payload = await response.clone().json() as { hint?: string; message?: string };
      if (payload.hint === 'STOREHUB_CLIENT_UPDATE_REQUIRED') {
        window.dispatchEvent(new CustomEvent(RELEASE_UPDATE_REQUIRED_EVENT, {
          detail: { message: payload.message },
        }));
      }
    } catch {
      // Non-JSON and unrelated API failures keep their original handling path.
    }
  }
  return response;
};

export const releaseAwareFetch = createReleaseAwareFetch();
