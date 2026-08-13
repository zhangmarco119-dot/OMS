import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ensureAiReview, loadAiReview } from '../../services/ai-review.service';
import { AiEntityReviewPanel } from './AiEntityReviewPanel';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../services/ai-review.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ai-review.service')>();
  return { ...actual, ensureAiReview: vi.fn(), loadAiReview: vi.fn() };
});

describe('AiEntityReviewPanel access boundary', () => {
  it('renders nothing and makes no AI request when the caller is not enabled', async () => {
    render(<AiEntityReviewPanel enabled={false} entityId="task-1" storeId="store-1" workflow="inventory" />);

    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByTestId('ai-entity-review')).not.toBeInTheDocument();
    expect(ensureAiReview).not.toHaveBeenCalled();
    expect(loadAiReview).not.toHaveBeenCalled();
  });
});
