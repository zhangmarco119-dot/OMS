import { describe, expect, it, vi } from 'vitest';
import { uploadPayrollEvidence } from './payroll.service';
import { compressArrivalImage } from './arrival-images.service';
vi.mock('./arrival-images.service', async (original) => ({ ...await original<typeof import('./arrival-images.service')>(), compressArrivalImage: vi.fn() }));
describe('penalty image upload', () => {
  it('compresses a large photo and stores the compressed content metadata', async () => {
    const compressed = new Blob(['small'], { type: 'image/jpeg' });
    vi.mocked(compressArrivalImage).mockResolvedValue({ blob: compressed, height: 100, width: 100, mimeType: 'image/jpeg' });
    const upload = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const client = { storage: { from: () => ({ upload, remove: vi.fn() }) }, from: () => ({ insert }) };
    const file = new File([new Uint8Array(11 * 1024 * 1024)], '手机照片.jpg', { type: 'image/jpeg' });
    await uploadPayrollEvidence(client as never, { file, ownerId: 'owner', entityId: 'penalty' });
    expect(compressArrivalImage).toHaveBeenCalledWith(file);
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^owner\/penalty\/penalty\//), compressed, expect.objectContaining({ contentType: 'image/jpeg' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ penalty_id: 'penalty', size_bytes: compressed.size, file_name: '手机照片.jpg' }));
  });
});
