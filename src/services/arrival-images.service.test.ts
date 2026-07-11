import { describe, expect, it } from 'vitest';

import { validateArrivalImageFile } from './arrival-images.service';

describe('arrival image validation', () => {
  it('accepts supported image formats', () => {
    expect(() => validateArrivalImageFile(new File(['image'], 'arrival.jpg', {
      type: 'image/jpeg',
    }))).not.toThrow();
  });

  it('rejects unsupported files', () => {
    expect(() => validateArrivalImageFile(new File(['pdf'], 'arrival.pdf', {
      type: 'application/pdf',
    }))).toThrow('只支持 JPG、PNG 或 WEBP 图片。');
  });
});
