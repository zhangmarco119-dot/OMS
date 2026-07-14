import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyTaskTemplate } from '../features/task-templates/templateForm';
import type { Database } from '../types/database';
import { publishTaskTemplate, retractTaskTemplate, saveTaskTemplate, uploadTaskTemplateReferenceImage } from './task-templates.service';

vi.mock('./arrival-images.service', () => ({
  compressArrivalImage: vi.fn().mockResolvedValue({
    blob: new Blob(['image'], { type: 'image/jpeg' }),
    height: 100,
    mimeType: 'image/jpeg',
    width: 100,
  }),
}));

const storeId = '00000000-0000-4000-8000-000000000001';

describe('task templates service', () => {
  it('serializes grouped items through the protected save RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'template-1' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const draft = createEmptyTaskTemplate([storeId]);
    draft.name = '每周闭店清洁';
    draft.groups[0].title = '操作间';
    draft.groups[0].items[0].label = '确认操作台已消毒';
    await saveTaskTemplate(client, draft);
    expect(rpc).toHaveBeenCalledWith('save_v2_task_template', expect.objectContaining({
      p_store_ids: [storeId],
      p_template_id: null,
      p_groups: [expect.objectContaining({ items: [expect.objectContaining({ field_type: 'confirmation' })] })],
    }));
  });

  it('publishes a version through the database RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { version: 1 }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await publishTaskTemplate(client, '00000000-0000-4000-8000-000000000099');
    expect(rpc).toHaveBeenCalledWith('publish_v2_task_template', {
      p_template_id: '00000000-0000-4000-8000-000000000099',
    });
  });

  it('retracts a published template back to a draft', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'draft' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    await retractTaskTemplate(client, '00000000-0000-4000-8000-000000000099');
    expect(rpc).toHaveBeenCalledWith('retract_v2_task_template', {
      p_template_id: '00000000-0000-4000-8000-000000000099',
    });
  });

  it('preserves server reference images when a restored mobile draft is stale', async () => {
    const templateId = '00000000-0000-4000-8000-000000000010';
    const draft = createEmptyTaskTemplate([storeId]);
    draft.id = templateId;
    draft.name = '带参考图模板';
    draft.groups[0].title = '检查区';
    draft.groups[0].items[0].label = '检查陈列';
    const itemId = draft.groups[0].items[0].id;
    const path = `${templateId}/${itemId}/00000000-0000-4000-8000-000000000099.jpg`;
    const inItems = vi.fn().mockResolvedValue({
      data: [{ id: itemId, reference_image_path: path, reference_image_paths: [path] }],
      error: null,
    });
    const eqTemplate = vi.fn().mockReturnValue({ in: inItems });
    const selectItems = vi.fn().mockReturnValue({ eq: eqTemplate });
    const from = vi.fn().mockReturnValue({ select: selectItems });
    const rpc = vi.fn().mockResolvedValue({ data: { id: templateId, status: 'draft' }, error: null });
    const client = { from, rpc } as unknown as SupabaseClient<Database>;

    await saveTaskTemplate(client, draft);

    expect(rpc).toHaveBeenCalledWith('save_v2_task_template', expect.objectContaining({
      p_groups: [expect.objectContaining({
        items: [expect.objectContaining({
          reference_image_path: path,
          reference_image_paths: [path],
        })],
      })],
    }));
  });

  it('uploads a reference image directly to storage and atomically attaches it', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/reference.jpg' }, error: null });
    const from = vi.fn().mockReturnValue({ createSignedUrl, remove, upload });
    const rpc = vi.fn().mockResolvedValue({ data: ['path'], error: null });
    const client = { rpc, storage: { from } } as unknown as SupabaseClient<Database>;
    const templateId = '00000000-0000-4000-8000-000000000010';
    const itemId = '00000000-0000-4000-8000-000000000020';

    const onProgress = vi.fn();
    const result = await uploadTaskTemplateReferenceImage(
      client,
      templateId,
      itemId,
      new File(['image'], 'reference.jpg', { type: 'image/jpeg' }),
      onProgress,
    );

    expect(from).toHaveBeenCalledWith('v2-task-template-reference-images');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${templateId}/${itemId}/[0-9a-f-]+\\.jpg$`)),
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
    );
    const uploadedPath = upload.mock.calls[0][0] as string;
    expect(rpc).toHaveBeenCalledWith('attach_v2_task_template_reference_image', {
      p_item_id: itemId,
      p_path: uploadedPath,
      p_template_id: templateId,
    });
    expect(createSignedUrl).toHaveBeenCalledWith(uploadedPath, 3600);
    expect(result).toEqual({ path: uploadedPath, previewUrl: 'https://signed.example/reference.jpg' });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([5, 35, 70, 85, 100]);
    expect(remove).not.toHaveBeenCalled();
  });
});
