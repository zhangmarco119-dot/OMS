import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { PhaseStatusPage } from './PhaseStatusPage';

describe('PhaseStatusPage', () => {
  it('shows current phase and main route plan', () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <PhaseStatusPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '移动端门店盘点订货系统' })).toBeInTheDocument();
    expect(screen.getByText('阶段 9 测试和部署')).toBeInTheDocument();
    expect(screen.getByText('/app/inventory')).toBeInTheDocument();
    expect(screen.getByText('/app/order')).toBeInTheDocument();
    expect(screen.getByText('/app/admin')).toBeInTheDocument();
  });
});
