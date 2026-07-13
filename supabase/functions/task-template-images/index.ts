import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

const bucket = 'v2-task-template-reference-images';
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxFileSize = 10 * 1024 * 1024;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const requiredEnv = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isValidPath = (path: string) => /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Missing Authorization header' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session' }, 401);

  const contentType = request.headers.get('content-type') ?? '';
  const form = contentType.includes('multipart/form-data') ? await request.formData() : null;
  const body = form ? null : await request.json() as Record<string, unknown>;
  const action = String(form?.get('action') ?? body?.action ?? '');

  if (action === 'upload') {
    const templateId = String(form?.get('templateId') ?? '');
    const itemId = String(form?.get('itemId') ?? '');
    const file = form?.get('file');
    if (!isUuid(templateId) || !isUuid(itemId) || !(file instanceof File)) return json({ error: 'Invalid image upload request' }, 400);
    if (!allowedMimeTypes.has(file.type) || file.size > maxFileSize) return json({ error: '仅支持 10MB 以内的 JPG、PNG 或 WebP 图片' }, 400);
    const { data: canManage, error: permissionError } = await userClient.rpc('can_manage_v2_task_template', { target_template_id: templateId });
    if (permissionError || !canManage) return json({ error: '没有管理该任务模板的权限' }, 403);

    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${templateId}/${itemId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await serviceClient.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return json({ error: uploadError.message }, 400);
    const { data: signed, error: signError } = await serviceClient.storage.from(bucket).createSignedUrl(path, 60 * 60);
    if (signError || !signed?.signedUrl) return json({ error: signError?.message ?? '图片上传成功但预览生成失败' }, 400);
    return json({ path, signedUrl: signed.signedUrl });
  }

  if (action === 'sign') {
    const path = String(body?.path ?? '');
    const scope = String(body?.scope ?? '');
    if (!isValidPath(path)) return json({ error: 'Invalid reference image path' }, 400);
    if (scope === 'template') {
      const templateId = String(body?.templateId ?? '');
      const { data: canManage, error: permissionError } = await userClient.rpc('can_manage_v2_task_template', { target_template_id: templateId });
      if (!isUuid(templateId) || permissionError || !canManage || !path.startsWith(`${templateId}/`)) return json({ error: '没有查看该参考图片的权限' }, 403);
    } else if (scope === 'task') {
      const taskId = String(body?.taskId ?? '');
      const { data: canRead, error: permissionError } = await userClient.rpc('can_read_v2_task', { p_task_id: taskId });
      if (!isUuid(taskId) || permissionError || !canRead) return json({ error: '没有查看该任务的权限' }, 403);
      const { data: answers, error: answersError } = await serviceClient.from('v2_task_answers').select('item_snapshot').eq('task_id', taskId);
      if (answersError || !(answers ?? []).some((answer) => (answer.item_snapshot as Record<string, unknown>).reference_image_path === path)) return json({ error: '任务中未包含该参考图片' }, 404);
    } else return json({ error: 'Invalid image scope' }, 400);

    const { data: signed, error: signError } = await serviceClient.storage.from(bucket).createSignedUrl(path, 60 * 60);
    if (signError || !signed?.signedUrl) return json({ error: signError?.message ?? '参考图片不可用' }, 400);
    return json({ signedUrl: signed.signedUrl });
  }

  if (action === 'task-references') {
    const taskId = String(body?.taskId ?? '');
    if (!isUuid(taskId)) return json({ error: '任务编号无效' }, 400);
    const { data: canRead, error: permissionError } = await userClient.rpc('can_read_v2_task', { p_task_id: taskId });
    if (permissionError || !canRead) return json({ error: '没有查看该任务的权限' }, 403);
    const [{ data: task, error: taskError }, { data: answers, error: answersError }] = await Promise.all([
      serviceClient.from('v2_tasks').select('template_id').eq('id', taskId).single(),
      serviceClient.from('v2_task_answers').select('item_id,item_snapshot').eq('task_id', taskId),
    ]);
    if (taskError || !task || answersError) return json({ error: taskError?.message ?? answersError?.message ?? '任务参考图片加载失败' }, 400);
    const snapshotPaths = new Map((answers ?? []).flatMap((answer) => {
      const path = (answer.item_snapshot as Record<string, unknown>).reference_image_path;
      return typeof path === 'string' && isValidPath(path) ? [[answer.item_id, path] as const] : [];
    }));
    const missingItemIds = (answers ?? []).filter((answer) => !snapshotPaths.has(answer.item_id)).map((answer) => answer.item_id);
    if (missingItemIds.length > 0) {
      const { data: templateItems, error: templateItemsError } = await serviceClient
        .from('v2_task_template_items')
        .select('id,reference_image_path')
        .eq('template_id', task.template_id)
        .in('id', missingItemIds);
      if (templateItemsError) return json({ error: templateItemsError.message }, 400);
      (templateItems ?? []).forEach((item) => {
        if (item.reference_image_path && isValidPath(item.reference_image_path)) snapshotPaths.set(item.id, item.reference_image_path);
      });
    }
    const signedEntries = await Promise.all([...snapshotPaths.entries()].map(async ([itemId, path]) => {
      const { data: signed } = await serviceClient.storage.from(bucket).createSignedUrl(path, 60 * 60);
      return signed?.signedUrl ? [itemId, signed.signedUrl] as const : null;
    }));
    return json({ urls: Object.fromEntries(signedEntries.filter((entry): entry is readonly [string, string] => entry !== null)) });
  }

  return json({ error: 'Unknown action' }, 400);
});
