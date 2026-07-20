import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultArrivalPeriod } from './arrivalPeriod';
import { ArrivalPeriodFilter } from './ArrivalPeriodFilter';

describe('ArrivalPeriodFilter', () => {
  it('shows today by default and exposes day, month, and range modes', () => {
    const onChange = vi.fn();
    render(<ArrivalPeriodFilter onChange={onChange} value={createDefaultArrivalPeriod('2026-07-20')} />);

    expect(screen.getByRole('tab', { name: '选择某日' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('日期')).toHaveValue('2026-07-20');
    expect(screen.getByRole('tab', { name: '选择某月' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '选择时间区间' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '选择某月' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'month' }));
  });
});
