import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocation } from 'react-router-dom';

const PREFIX = 'storehub:page-state:';

export function useRememberedPageState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const { pathname } = useLocation();
  const storageKey = `${PREFIX}${pathname}:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored == null ? initialValue : JSON.parse(stored) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* restricted storage */ }
  }, [storageKey, value]);

  return [value, setValue];
}
