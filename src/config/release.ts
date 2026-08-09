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
export const TASK_IMAGE_UPLOAD_TIMEOUT_MESSAGE = '任务图片上传超时，请检查网络后自动重试。';

interface ReleaseAwareFetchOptions {
  taskImageUploadTimeoutMs?: number;
}

const requestUrl = (input: RequestInfo | URL) => typeof input === 'string'
  ? input
  : input instanceof URL
    ? input.href
    : input.url;

const requestMethod = (input: RequestInfo | URL, init?: RequestInit) => (
  init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
).toUpperCase();

const isTaskImageUploadRequest = (input: RequestInfo | URL, init?: RequestInit) => (
  ['POST', 'PUT'].includes(requestMethod(input, init))
  && requestUrl(input).includes('/storage/v1/object/v2-task-images/')
);

export const createReleaseAwareFetch = (fetcher: typeof fetch = fetch, options: ReleaseAwareFetchOptions = {}): typeof fetch => async (input, init) => {
  const timeoutMs = options.taskImageUploadTimeoutMs ?? 45_000;
  const shouldTimeOut = timeoutMs > 0 && isTaskImageUploadRequest(input, init);
  const controller = shouldTimeOut ? new AbortController() : null;
  const inheritedSignal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
  const forwardAbort = () => controller?.abort(inheritedSignal?.reason);
  if (controller && inheritedSignal) {
    if (inheritedSignal.aborted) forwardAbort();
    else inheritedSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timeout = controller ? window.setTimeout(() => controller.abort(new Error(TASK_IMAGE_UPLOAD_TIMEOUT_MESSAGE)), timeoutMs) : null;
  let response: Response;
  try {
    response = await fetcher(input, controller ? { ...init, signal: controller.signal } : init);
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    inheritedSignal?.removeEventListener('abort', forwardAbort);
  }
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
