import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUuid } from './uuid';

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'crypto');
  }
});

describe('createUuid', () => {
  it('uses the native randomUUID implementation when available', () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000' as `${string}-${string}-${string}-${string}-${string}`;
    const randomUUID = vi.fn(() => uuid);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID },
    });

    expect(createUuid()).toBe(uuid);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates a valid UUID v4 when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.forEach((_, index) => {
            bytes[index] = index;
          });
          return bytes;
        },
      },
    });

    expect(createUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('still creates a valid UUID v4 when Web Crypto is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });

    expect(createUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
