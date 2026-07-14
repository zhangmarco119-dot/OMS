import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AdminLegacyRedirect } from './AdminLegacyRedirect';

function CurrentPath() {
  const location = useLocation();
  return <p>{location.pathname}</p>;
}

describe('AdminLegacyRedirect', () => {
  it.each([
    ['/app/admin?tab=users', '/app/admin/users'],
    ['/app/admin?tab=products', '/app/admin/products'],
  ])('keeps the old %s address compatible', async (from, destination) => {
    render(
      <MemoryRouter initialEntries={[from]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes>
          <Route path="/app/admin" element={<AdminLegacyRedirect />} />
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(destination)).toBeInTheDocument();
  });
});
