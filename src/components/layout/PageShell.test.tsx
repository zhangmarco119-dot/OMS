import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rememberRoute } from '../../lib/navigationHierarchy';
import { PageShell } from './PageShell';

function CurrentPath() {
  const location = useLocation();
  return <p>{location.pathname}{location.search}</p>;
}

describe('PageShell hierarchical back behavior', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('returns to the remembered business parent and restores its filter', () => {
    window.history.replaceState({ idx: 1 }, '', '/app/sops/sop-1');
    rememberRoute('/app/sops', '?category=饮品');
    render(<MemoryRouter initialEntries={['/app/sops?category=饮品', '/app/sops/sop-1']} initialIndex={1} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/app/sops/:id" element={<PageShell backTo="/app/sops" title="SOP 详情"><p>详情</p></PageShell>} />
        <Route path="/app/sops" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('/app/sops?category=%E9%A5%AE%E5%93%81')).toBeInTheDocument();
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

  it('skips a previous peer tab and returns to the feature parent', () => {
    window.history.replaceState({ idx: 2 }, '', '/app/admin/payroll?tab=employees');
    render(<MemoryRouter initialEntries={['/app/admin/payroll?tab=overview', '/app/admin/payroll?tab=employees']} initialIndex={1} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/app/admin/payroll" element={<><PageShell backTo="/app/workbench" title="实时薪资"><p>员工参数</p></PageShell><CurrentPath /></>} />
        <Route path="/app/workbench" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('/app/workbench')).toBeInTheDocument();
  });
});
