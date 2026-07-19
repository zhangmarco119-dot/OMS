import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { RELEASE_UPDATE_REQUIRED_EVENT } from '../../config/release';
import {
  createReloadUrl,
  determineRequiredUpdate,
  fetchCurrentReleaseManifest,
  fetchSystemReleasePolicy,
  type ReleaseUpdateRequirement,
} from '../../services/release-control.service';

const DEFAULT_CHECK_INTERVAL_MS = 60_000;

export function ReleaseUpdateGuard({ children }: PropsWithChildren) {
  const checkingRef = useRef(false);
  const [requirement, setRequirement] = useState<ReleaseUpdateRequirement | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkRelease = useCallback(async () => {
    if (checkingRef.current || requirement) return;
    checkingRef.current = true;
    try {
      const [manifest, policy] = await Promise.all([
        fetchCurrentReleaseManifest(),
        fetchSystemReleasePolicy(),
      ]);
      setRequirement(determineRequiredUpdate({ manifest, policy }));
    } finally {
      checkingRef.current = false;
    }
  }, [requirement]);

  useEffect(() => {
    void checkRelease();
    const interval = window.setInterval(() => void checkRelease(), DEFAULT_CHECK_INTERVAL_MS);
    const onFocus = () => void checkRelease();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkRelease();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkRelease]);

  useEffect(() => {
    const onBackendBlock = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setRequirement({
        message: message || '当前页面版本已经停止使用，请立即更新后继续操作。',
        title: '当前版本已停用',
      });
    };
    window.addEventListener(RELEASE_UPDATE_REQUIRED_EVENT, onBackendBlock);
    return () => window.removeEventListener(RELEASE_UPDATE_REQUIRED_EVENT, onBackendBlock);
  }, []);

  const refresh = () => {
    if (!requirement || refreshing) return;
    setRefreshing(true);
    window.location.replace(createReloadUrl(requirement.serverBuildId));
  };

  return <>
    {children}
    {requirement ? <div className="ui-dialog-overlay z-[100]" role="alertdialog" aria-modal="true" aria-labelledby="release-update-title">
      <section className="ui-dialog-panel max-w-sm border border-emerald-100 p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900" id="release-update-title">{requirement.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{requirement.message}</p>
        <button className="ui-button-primary mt-5 w-full" disabled={refreshing} onClick={refresh} type="button">
          <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing ? '正在更新' : '立即更新'}
        </button>
      </section>
    </div> : null}
  </>;
}
