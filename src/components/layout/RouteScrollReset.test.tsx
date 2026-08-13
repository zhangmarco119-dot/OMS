import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouteScrollReset } from './RouteScrollReset';

describe('RouteScrollReset', () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window.history, 'scrollRestoration', { configurable: true, value: 'auto', writable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('resets window scrolling when the page path changes but not for a query-only update', () => {
    render(<MemoryRouter initialEntries={['/first']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RouteScrollReset />
      <Link to="/second">打开第二个页面</Link>
      <Link to="/second?view=history">切换第二页筛选</Link>
    </MemoryRouter>);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    document.documentElement.scrollTop = 180;
    document.body.scrollTop = 180;
    fireEvent.click(screen.getByRole('link', { name: '打开第二个页面' }));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', left: 0, top: 0 });
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('link', { name: '切换第二页筛选' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('restores the exact parent route scroll position after a business back', () => {
    function Controls() {
      const location = useLocation();
      return <>
        <output>{location.pathname}{location.search}</output>
        <Link to="/parent?month=2026-07">父页面</Link>
        <Link to="/child">子页面</Link>
        <Link replace state={{ restoreScroll: true }} to="/parent?month=2026-07">业务返回</Link>
      </>;
    }
    render(<MemoryRouter initialEntries={['/parent?month=2026-07']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RouteScrollReset />
      <Controls />
    </MemoryRouter>);

    document.documentElement.scrollTop = 236;
    document.body.scrollTop = 236;
    fireEvent.click(screen.getByRole('link', { name: '子页面' }));
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('link', { name: '业务返回' }));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', left: 0, top: 236 });
  });
});
