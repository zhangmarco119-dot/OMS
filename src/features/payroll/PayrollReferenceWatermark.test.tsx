import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PAYROLL_REFERENCE_TEXT, PayrollReferenceWatermark } from './PayrollReferenceWatermark';

describe('employee payroll reference watermark', () => {
  it('repeats the exact reference wording without intercepting content or controls', () => {
    const onClick = vi.fn();
    render(<PayrollReferenceWatermark><button onClick={onClick}>查看明细</button><p>¥1,000.00</p></PayrollReferenceWatermark>);
    const layer = screen.getByTestId('payroll-watermark-layer');
    expect(layer).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
    expect(layer).toHaveTextContent(PAYROLL_REFERENCE_TEXT);
    expect(layer.querySelector('pattern')).toHaveAttribute('width', '330');
    fireEvent.click(screen.getByRole('button', { name: '查看明细' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText('¥1,000.00')).toBeVisible();
  });
});
