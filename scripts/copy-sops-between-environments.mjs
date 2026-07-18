import { createClient } from '@supabase/supabase-js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

if (process.env.COPY_SOPS_CONFIRM !== 'COPY_DEVELOPMENT_SOPS_TO_PRODUCTION') {
  throw new Error('未提供 SOP 专用迁移确认值，已停止。');
}

const sourceUrl = required('SOURCE_SUPABASE_URL');
const targetUrl = required('TARGET_SUPABASE_URL');
if (sourceUrl === targetUrl) throw new Error('源数据库和目标数据库不能相同。');

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const source = createClient(sourceUrl, required('SOURCE_SUPABASE_SERVICE_ROLE_KEY'), clientOptions);
const target = createClient(targetUrl, required('TARGET_SUPABASE_SERVICE_ROLE_KEY'), clientOptions);
const sourceBucket = source.storage.from('v2-sop-assets');
const targetBucket = target.storage.from('v2-sop-assets');

const readAll = async (client, table, order = 'created_at') => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const request = client.from(table).select('*').range(from, from + 999);
    const { data, error } = order ? await request.order(order) : await request;
    if (error) throw new Error(`${table} 读取失败：${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
};

const upsertBatches = async (table, rows, onConflict) => {
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await target.from(table).upsert(rows.slice(index, index + 200), { onConflict });
    if (error) throw new Error(`${table} 写入失败：${error.message}`);
  }
};

const [categories, sops, stores, roles, assets] = await Promise.all([
  readAll(source, 'v2_sop_categories'),
  readAll(source, 'v2_sops'),
  readAll(source, 'v2_sop_stores'),
  readAll(source, 'v2_sop_roles'),
  readAll(source, 'v2_sop_assets'),
]);

if (!sops.length) throw new Error('开发数据库没有 SOP，未执行复制。');

const [{ data: targetAdmins, error: adminError }, { data: targetStores, error: storeError }, { data: targetTemplates, error: templateError }, { data: targetCategories, error: categoryError }] = await Promise.all([
  target.from('profiles').select('id,created_at').eq('role', 'admin').eq('is_active', true).is('deleted_at', null).order('created_at').limit(1),
  target.from('stores').select('id'),
  target.from('v2_task_templates').select('id'),
  target.from('v2_sop_categories').select('id,name'),
]);
const setupError = adminError ?? storeError ?? templateError ?? categoryError;
if (setupError) throw new Error(`正式库迁移前检查失败：${setupError.message}`);
const targetAdminId = targetAdmins?.[0]?.id;
if (!targetAdminId) throw new Error('正式数据库没有可用管理员账号。');

const targetStoreIds = new Set((targetStores ?? []).map((row) => row.id));
const missingStoreIds = [...new Set(stores.map((row) => row.store_id).filter((id) => !targetStoreIds.has(id)))];
if (missingStoreIds.length) throw new Error(`正式数据库缺少 SOP 所属门店：${missingStoreIds.join(', ')}`);

const targetTemplateIds = new Set((targetTemplates ?? []).map((row) => row.id));
const targetCategoryNames = new Set((targetCategories ?? []).map((row) => row.name));
const missingCategories = categories
  .filter((row) => !targetCategoryNames.has(row.name))
  .map((row) => ({ ...row, created_by: targetAdminId }));
await upsertBatches('v2_sop_categories', missingCategories, 'id');

await upsertBatches('v2_sops', sops.map((row) => ({
  ...row,
  created_by: targetAdminId,
  task_template_id: row.task_template_id && targetTemplateIds.has(row.task_template_id) ? row.task_template_id : null,
})), 'id');
await upsertBatches('v2_sop_stores', stores, 'sop_id,store_id');
await upsertBatches('v2_sop_roles', roles, 'sop_id,role');

const objectAssets = assets.filter((asset) => asset.object_path);
let copiedObjects = 0;
const copyObject = async (asset) => {
  const downloaded = await sourceBucket.download(asset.object_path);
  if (downloaded.error) throw new Error(`${asset.object_path} 下载失败：${downloaded.error.message}`);
  const uploaded = await targetBucket.upload(asset.object_path, downloaded.data, {
    cacheControl: '3600',
    contentType: asset.mime_type ?? undefined,
    upsert: true,
  });
  if (uploaded.error) throw new Error(`${asset.object_path} 上传失败：${uploaded.error.message}`);
  copiedObjects += 1;
  if (copiedObjects === objectAssets.length || copiedObjects % 20 === 0) {
    console.log(`SOP 图片复制进度 ${copiedObjects}/${objectAssets.length}`);
  }
};

for (let index = 0; index < objectAssets.length; index += 4) {
  await Promise.all(objectAssets.slice(index, index + 4).map(copyObject));
}

await upsertBatches('v2_sop_assets', assets.map((row) => ({ ...row, uploaded_by: targetAdminId })), 'id');

const copiedIds = new Set(sops.map((row) => row.id));
const [targetSops, targetAssets, targetStoresRows, targetRolesRows] = await Promise.all([
  readAll(target, 'v2_sops'),
  readAll(target, 'v2_sop_assets'),
  readAll(target, 'v2_sop_stores'),
  readAll(target, 'v2_sop_roles'),
]);
const result = {
  source: { assets: assets.length, categories: categories.length, objects: objectAssets.length, roles: roles.length, sops: sops.length, stores: stores.length },
  targetCopied: {
    assets: targetAssets.filter((row) => copiedIds.has(row.sop_id)).length,
    roles: targetRolesRows.filter((row) => copiedIds.has(row.sop_id)).length,
    sops: targetSops.filter((row) => copiedIds.has(row.id)).length,
    stores: targetStoresRows.filter((row) => copiedIds.has(row.sop_id)).length,
  },
};

if (result.targetCopied.sops !== result.source.sops
  || result.targetCopied.assets !== result.source.assets
  || result.targetCopied.roles !== result.source.roles
  || result.targetCopied.stores !== result.source.stores) {
  throw new Error(`SOP 复制后数量校验失败：${JSON.stringify(result)}`);
}

console.log(`SOP 复制完成：${JSON.stringify(result)}`);
