import { describe, expect, it } from 'vitest';

import { loginSchema } from './loginSchema';

describe('loginSchema', () => {
  it('accepts an account name and non-empty password', () => {
    expect(loginSchema.safeParse({ identifier: 'staff-01', password: 'secret' }).success).toBe(true);
  });

  it('accepts a display name', () => {
    expect(loginSchema.safeParse({ identifier: '张三', password: 'secret' }).success).toBe(true);
  });

  it('keeps an existing auth email valid as a compatibility login', () => {
    expect(loginSchema.safeParse({ identifier: 'admin@example.com', password: 'secret' }).success).toBe(true);
  });

  it('rejects empty account input', () => {
    const result = loginSchema.safeParse({ identifier: '  ', password: '' });

    expect(result.success).toBe(false);
  });
});
