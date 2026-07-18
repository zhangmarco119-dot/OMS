type IdleCapableWindow = Window & typeof globalThis & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

export const scheduleSopBackgroundLoad = (callback: () => void) => {
  const browser = window as IdleCapableWindow;
  if (typeof browser.requestIdleCallback === 'function') {
    const handle = browser.requestIdleCallback(callback, { timeout: 1_200 });
    return () => browser.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 350);
  return () => window.clearTimeout(handle);
};
