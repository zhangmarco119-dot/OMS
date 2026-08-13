import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../auth/AuthContext';
import { actOnAiSuggestion, checkAiProductDraft, loadAiReview } from '../../services/ai-review.service';
import { ProductAiDraftCheck } from './ProductAiDraftCheck';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../services/ai-review.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ai-review.service')>();
  return {
    ...actual,
    actOnAiSuggestion: vi.fn(),
    checkAiProductDraft: vi.fn(),
    loadAiReview: vi.fn(),
    rerunAiReview: vi.fn(),
    skipAiReview: vi.fn(),
  };
});

const draft = { category_code: 'other_food' as const, count_unit: '瓶', name: '原味酸奶', product_code: '', sort_order: 1, spec: '500ml', store_id: 'store-1' };
const suggestion = {
  actionType: 'replace_fields',
  confidence: 0.9,
  currentValue: '原味酸奶',
  draftPatch: { name: '原味酸奶饮品' },
  fieldPath: 'product.name',
  id: 'suggestion-1',
  issueType: 'name_normalization',
  rationale: '名称可进一步标准化',
  severity: 'warning' as const,
  sourceHash: 'source-hash-1',
  status: 'pending' as const,
  suggestedValue: '原味酸奶饮品',
  title: '名称建议规范化',
};
const review = {
  run: { completedAt: '2026-08-13T01:00:00Z', createdAt: '2026-08-13T00:59:00Z', entityId: 'product-1', errorMessage: null, id: 'run-1', maxSeverity: 'warning' as const, pendingCount: 1, sourceHash: 'source-hash-1', status: 'completed' as const, storeId: 'store-1', storeName: '五道口店', suggestionCount: 1, summary: '发现 1 项建议', workflow: 'product' as const },
  suggestions: [suggestion],
};

describe('ProductAiDraftCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } } as ReturnType<typeof useAuth>);
    vi.mocked(checkAiProductDraft).mockResolvedValue(review);
    vi.mocked(loadAiReview).mockResolvedValue({ ...review, suggestions: [{ ...suggestion, status: 'applied_to_draft' }] });
    vi.mocked(actOnAiSuggestion).mockResolvedValue({ actionType: 'replace_fields', draftPatch: { name: '原味酸奶饮品' }, runId: 'run-1', sourceHash: 'source-hash-1', status: 'applied_to_draft', suggestionId: 'suggestion-1', targetEntityId: 'product-1', targetEntityType: 'product', targetStoreId: 'store-1' });
  });

  afterEach(() => vi.useRealTimers());

  it('runs automatically after fields stay stable for one second and applies only to the draft callback', async () => {
    const onApply = vi.fn();
    render(<ProductAiDraftCheck autoRunEnabled draft={draft} enabled onApply={onApply} productId="product-1" storeId="store-1" />);
    expect(checkAiProductDraft).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(checkAiProductDraft).toHaveBeenCalledWith({}, expect.objectContaining({ productId: 'product-1', storeId: 'store-1' }));
    fireEvent.click(screen.getByRole('button', { name: '采纳到草稿' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(actOnAiSuggestion).toHaveBeenCalledWith({}, 'suggestion-1', 'apply_to_draft', null, 'source-hash-1');
    expect(onApply).toHaveBeenCalledWith({ name: '原味酸奶饮品' });
  });

  it('lets the administrator skip waiting without disabling the original save action', async () => {
    vi.mocked(checkAiProductDraft).mockReturnValue(new Promise(() => undefined));
    const onSkipAndSave = vi.fn();
    render(<div><ProductAiDraftCheck autoRunEnabled draft={draft} enabled onApply={vi.fn()} onSkipAndSave={onSkipAndSave} storeId="store-1" /><button type="button">保存货品</button></div>);
    await act(async () => { vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByRole('button', { name: '跳过本次检查并继续保存' }));
    expect(screen.getByText(/正在按原流程保存/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存货品' })).toBeEnabled();
    expect(onSkipAndSave).toHaveBeenCalledTimes(1);
  });

  it('does not apply a draft patch when the database marks the suggestion stale', async () => {
    const onApply = vi.fn();
    vi.mocked(actOnAiSuggestion).mockResolvedValue({ actionType: null, draftPatch: {}, runId: 'run-1', sourceHash: null, status: 'stale', suggestionId: 'suggestion-1', targetEntityId: null, targetEntityType: null, targetStoreId: null });
    render(<ProductAiDraftCheck autoRunEnabled draft={draft} enabled onApply={onApply} productId="product-1" storeId="store-1" />);
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: '采纳到草稿' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/这条 AI 建议已失效/)).toBeInTheDocument();
  });

  it('opens a suggested existing product without applying product_id or marking the suggestion adopted', async () => {
    const useExistingSuggestion = {
      ...suggestion,
      actionType: 'use_existing_product',
      draftPatch: { product_id: 'product-2' },
      suggestedValue: { product_id: 'product-2', name: '已有原味酸奶' },
    };
    vi.mocked(checkAiProductDraft).mockResolvedValue({ ...review, suggestions: [useExistingSuggestion] });
    const onApply = vi.fn();
    const onUseExistingProduct = vi.fn();

    render(<ProductAiDraftCheck autoRunEnabled draft={draft} enabled onApply={onApply} onUseExistingProduct={onUseExistingProduct} productId="product-1" storeId="store-1" />);
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });

    expect(screen.queryByRole('button', { name: '修改后采纳' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '仅打开已有货品' }));

    expect(onUseExistingProduct).toHaveBeenCalledWith('product-2', useExistingSuggestion);
    expect(onApply).not.toHaveBeenCalled();
    expect(actOnAiSuggestion).not.toHaveBeenCalled();
    expect(screen.getByText(/没有写入 product_id/)).toBeInTheDocument();
  });

  it('is completely invisible and makes no request for staff accounts', async () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { id: 'staff-1', role: 'staff' } } as ReturnType<typeof useAuth>);
    render(<ProductAiDraftCheck autoRunEnabled draft={draft} enabled onApply={vi.fn()} storeId="store-1" />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(screen.queryByText('AI 草稿检查')).not.toBeInTheDocument();
    expect(checkAiProductDraft).not.toHaveBeenCalled();
  });
it('makes no model request when automatic analysis is turned off', async () => {
    render(<ProductAiDraftCheck autoRunEnabled={false} draft={draft} enabled onApply={vi.fn()} storeId="store-1" />);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(checkAiProductDraft).not.toHaveBeenCalled();
    expect(screen.getByText('AI 自动分析已关闭，可在 AI 质检中心重新开启。')).toBeInTheDocument();
  });
});
