import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { useRememberedPageState } from './useRememberedPageState';

describe('useRememberedPageState', () => {
  beforeEach(() => sessionStorage.clear());

  it('restores list filters after the page is unmounted and reopened', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/app/list']}>{children}</MemoryRouter>;
    const first = renderHook(() => useRememberedPageState('filters', { category: 'all', query: '' }), { wrapper });
    act(() => first.result.current[1]({ category: '酸奶碗', query: '芒果' }));
    first.unmount();
    const second = renderHook(() => useRememberedPageState('filters', { category: 'all', query: '' }), { wrapper });
    expect(second.result.current[0]).toEqual({ category: '酸奶碗', query: '芒果' });
  });
});
