import { describe, expect, it } from 'vitest';
import { userFacingError } from './userFacingError';

describe('userFacingError', () => {
  it.each(['<!DOCTYPE html><html><title>502: Bad gateway</title></html>', '<!--[if IE 7]><html class="no-js">', 'TypeError: Failed to fetch', 'NetworkError when attempting to fetch resource.', ''])('never shows gateway markup or raw network errors: %s', (message) => {
    expect(userFacingError(new Error(message), '请重新加载')).toBe('请重新加载');
  });
  it('preserves actionable validation messages', () => {
    expect(userFacingError(new Error('实际个税必须大于或等于0。'))).toBe('实际个税必须大于或等于0。');
  });
});
