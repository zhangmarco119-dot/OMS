exports.installNativeScrolling = (window, document, wx) => {
  const currentTop = () => Number(document.documentElement.$$scrollTop) || 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: currentTop });
  Object.defineProperty(window, 'pageYOffset', { configurable: true, get: currentTop });
  window.scrollTo = (first, second) => {
    const options = first && typeof first === 'object' ? first : { top: second };
    const top = options.top === undefined ? currentTop() : Number(options.top);
    const scrollTop = Number.isFinite(top) ? Math.max(0, top) : 0;
    wx.pageScrollTo({ scrollTop, duration: options.behavior === 'smooth' ? 300 : 0 });
    document.documentElement.$$scrollTop = scrollTop;
  };
  window.scrollBy = (first, second) => {
    const options = first && typeof first === 'object' ? first : { top: second };
    window.scrollTo({ ...options, top: currentTop() + (Number(options.top) || 0) });
  };
};
