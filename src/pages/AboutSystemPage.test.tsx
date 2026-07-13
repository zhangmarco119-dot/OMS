import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { systemReleaseHistory, systemVersion } from '../config/version';
import { AboutSystemPage } from './AboutSystemPage';

describe('AboutSystemPage', () => {
  it('shows the current version and all recorded updates', () => {
    render(<MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AboutSystemPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: '关于系统' })).toBeInTheDocument();
    expect(screen.getByText(`当前版本：${systemVersion}`)).toBeInTheDocument();
    expect(screen.getByText('版本更新记录')).toBeInTheDocument();
    for (const release of systemReleaseHistory) expect(screen.getByText(release.title)).toBeInTheDocument();
  });
});
