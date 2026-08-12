import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { PageShell } from './PageShell';

function CurrentPath() {
  const location = useLocation();
  return <p>{location.pathname}{location.search}</p>;
}

describe('PageShell hierarchical back behavior', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('pops the real browser entry when a child was opened from its parent', () => {
    window.history.replaceState({ idx: 1 }, '', '/app/sops/sop-1');
    render(<MemoryRouter initialEntries={['/app/sops?category=饮品', '/app/sops/sop-1']} initialIndex={1} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/app/sops/:id" element={<PageShell backTo="/app/sops" title="SOP 详情"><p>详情</p></PageShell>} />
        <Route path="/app/sops" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('/app/sops?category=饮品')).toBeInTheDocument();
  });

  it('uses the logical query parent only when the detail was opened directly', () => {
    window.history.replaceState({ idx: 0 }, '', '/app/admin/payroll?tab=overview&employee=p1');
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=overview&employee=p1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/app/admin/payroll" element={<><PageShell backTo="/app/workbench" title="实时薪资"><p>详情</p></PageShell><CurrentPath /></>} />
      </Routes>
    </MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('/app/admin/payroll?tab=overview')).toBeInTheDocument();
  });
});
