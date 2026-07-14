import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useSopCategoryFilter = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('category')?.trim() || 'all';
  const setCategory = useCallback((nextCategory: string) => {
    const next = new URLSearchParams(searchParams);
    if (!nextCategory || nextCategory === 'all') next.delete('category');
    else next.set('category', nextCategory);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return [category, setCategory] as const;
};
