import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SuccessToast } from '../feedback/SuccessToast';
import { ActionFeedbackDialog } from '../feedback/ActionFeedbackDialog';
import { ConfirmDialog, MobileActionBar } from './Actions';

describe('mobile overlay safety', () => {
  it('uses the shared navigation-safe overlay for confirmation dialogs', () => {
    render(<ConfirmDialog onCancel={vi.fn()} onConfirm={vi.fn()} open title="确认操作">确认后立即生效。</ConfirmDialog>);

    const dialog = screen.getByRole('dialog', { name: '确认操作' });
    expect(dialog).toHaveClass('ui-dialog-overlay');
    expect(dialog.firstElementChild).toHaveClass('ui-dialog-panel');
  });

  it('shows success feedback as a centered acknowledgment dialog', () => {
    render(<SuccessToast message="保存成功" onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '操作成功' });
    expect(dialog).toHaveClass('ui-dialog-overlay');
    expect(screen.getByRole('button', { name: '我知道了' })).toBeInTheDocument();
  });

  it('keeps sticky page actions above the navigation safe area', () => {
    render(<MobileActionBar><button type="button">保存</button></MobileActionBar>);

    expect(screen.getByRole('button', { name: '保存' }).parentElement).toHaveClass('bottom-[calc(5.25rem+env(safe-area-inset-bottom))]');
  });

  it('shows blocking validation feedback in a visible warning dialog', () => {
    render(<ActionFeedbackDialog message="请先勾选项目" onClose={vi.fn()} open title="请完善审核信息" tone="warning" />);

    expect(screen.getByRole('dialog', { name: '请完善审核信息' })).toHaveTextContent('请先勾选项目');
  });
});
