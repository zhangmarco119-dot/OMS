import { validPayrollCustomItems } from './model';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PayrollCustomItemsEditor } from './PayrollCustomItemsEditor';
import type { PayrollCustomItem } from './model';

function Editor() {
  const [items, setItems] = useState<PayrollCustomItem[]>([{ id: 'first', name: '另外奖励', amount: 20 }]);
  return <PayrollCustomItemsEditor items={items} onChange={setItems} />;
}

describe('monthly payroll additions editor', () => {
  it('appends, edits and removes individual rows without disturbing other entries', () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: '增加工资条目' }));
    fireEvent.change(screen.getByLabelText('条目 2 名称'), { target: { value: '另外补贴' } });
    fireEvent.change(screen.getByLabelText('条目 2 金额'), { target: { value: '123.45' } });
    expect(screen.getByLabelText('条目 1 名称')).toHaveValue('另外奖励');
    expect(screen.getByText('条目合计 ¥143.45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除条目 1' }));
    expect(screen.getByLabelText('条目 1 名称')).toHaveValue('另外补贴');
    expect(screen.getByText('条目合计 ¥123.45')).toBeInTheDocument();
  });
  it('accepts zero amounts and deletion of all rows but rejects empty or invalid amounts', () => {
    expect(validPayrollCustomItems([])).toBe(true);
    expect(validPayrollCustomItems([{ id: 'a', name: '补贴', amount: 0 }])).toBe(true);
    for (const amount of [-1, NaN, Infinity, 10000000000]) expect(validPayrollCustomItems([{ id: 'a', name: '补贴', amount }])).toBe(false);
    expect(validPayrollCustomItems([{ id: 'a', name: '  ', amount: 10 }])).toBe(false);
  });
});
