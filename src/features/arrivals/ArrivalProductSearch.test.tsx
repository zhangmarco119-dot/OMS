import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArrivalProductSearch } from './ArrivalProductSearch';

describe('ArrivalProductSearch mobile layout', () => {
  it('keeps the field and clear action in one flexible row without native mobile search controls', () => {
    const onChange = vi.fn();
    render(<ArrivalProductSearch ariaLabel="检索产品" clearAriaLabel="清空检索" onChange={onChange} placeholder="输入产品名称" value="淡奶油" />);

    const input = screen.getByRole('searchbox', { name: '检索产品' });
    expect(input).toHaveClass('ui-search-input', 'min-w-0', 'flex-1', 'text-base');
    expect(screen.getByRole('button', { name: '清空检索' })).toHaveClass('shrink-0');

    fireEvent.click(screen.getByRole('button', { name: '清空检索' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
