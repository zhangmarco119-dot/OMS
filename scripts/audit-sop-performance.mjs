/* global AbortController, fetch */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';

import { createClient } from '@supabase/supabase-js';

const envFile = process.env.SUPABASE_ENV_FILE ?? '.env.development.local';
const envText = readFileSync(envFile, 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
const identifier = process.env.SOP_AUDIT_IDENTIFIER;
const password = process.env.SOP_AUDIT_PASSWORD;

if (!url || !anonKey) throw new Error(`${envFile} 缺少开发 Supabase 配置。`);
if (!identifier || !password) throw new Error('请通过 SOP_AUDIT_IDENTIFIER 和 SOP_AUDIT_PASSWORD 提供开发账号。');

const client = createClient(url, anonKey, { auth: { persistSession: false } });
const login = await client.functions.invoke('account-login', { body: { identifier, password } });
if (login.error || login.data?.error) throw new Error(login.data?.error ?? login.error?.message ?? '登录失败');
const session = await client.auth.setSession({ access_token: login.data.accessToken, refresh_token: login.data.refreshToken });
if (session.error) throw session.error;

const fetchAll = async (table, select, pageSize = 1_000) => {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const result = await client.from(table).select(select).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
};

const [sops, assets] = await Promise.all([
  fetchAll('v2_sops', 'id,title,status'),
  fetchAll('v2_sop_assets', 'id,sop_id,asset_kind,object_path,size_bytes,mime_type'),
]);
const imageAssets = assets.filter((asset) => asset.object_path && asset.mime_type?.startsWith('image/'));
const totalBytes = imageAssets.reduce((sum, asset) => sum + Number(asset.size_bytes ?? 0), 0);
const sorted = [...imageAssets].sort((left, right) => Number(right.size_bytes ?? 0) - Number(left.size_bytes ?? 0));
const bySop = new Map();
for (const asset of imageAssets) {
  const current = bySop.get(asset.sop_id) ?? { bytes: 0, count: 0 };
  current.bytes += Number(asset.size_bytes ?? 0);
  current.count += 1;
  bySop.set(asset.sop_id, current);
}
const topSops = [...bySop.entries()]
  .map(([id, values]) => ({ id, title: sops.find((sop) => sop.id === id)?.title ?? id, ...values }))
  .sort((left, right) => right.bytes - left.bytes)
  .slice(0, 5);

console.log(JSON.stringify({
  assetCount: imageAssets.length,
  averageBytes: imageAssets.length ? Math.round(totalBytes / imageAssets.length) : 0,
  largestBytes: Number(sorted[0]?.size_bytes ?? 0),
  publishedSopCount: sops.filter((sop) => sop.status === 'published').length,
  sopCount: sops.length,
  topSops,
  totalBytes,
}, null, 2));

const detailSample = sops.find((sop) => sop.status === 'published');
if (detailSample) {
  const detailStartedAt = performance.now();
  const detail = await client.rpc('get_v2_sop_detail', { p_sop_id: detailSample.id });
  if (detail.error) throw detail.error;
  console.log(JSON.stringify({
    detailAssetCount: Array.isArray(detail.data?.assets) ? detail.data.assets.length : 0,
    detailElapsedMs: Math.round(performance.now() - detailStartedAt),
    detailRpcReadable: Boolean(detail.data?.id),
  }, null, 2));
}

const sample = sorted[0];
if (sample?.object_path) {
  const storage = client.storage.from('v2-sop-assets');
  const signStart = performance.now();
  const [original, thumbnail, detailImage] = await Promise.all([
    storage.createSignedUrl(sample.object_path, 300),
    storage.createSignedUrl(sample.object_path, 300, { transform: { height: 256, quality: 60, resize: 'cover', width: 256 } }),
    storage.createSignedUrl(sample.object_path, 300, { transform: { quality: 72, resize: 'contain', width: 960 } }),
  ]);
  const signElapsedMs = Math.round(performance.now() - signStart);
  if (original.error) throw original.error;
  if (thumbnail.error) throw thumbnail.error;
  if (detailImage.error) throw detailImage.error;

  const download = async (signedUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const startedAt = performance.now();
    try {
      const response = await fetch(signedUrl, { signal: controller.signal });
      const body = await response.arrayBuffer();
      return {
        bytes: body.byteLength,
        contentType: response.headers.get('content-type'),
        elapsedMs: Math.round(performance.now() - startedAt),
        ok: response.ok,
        status: response.status,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const originalDownload = await download(original.data.signedUrl);
  const thumbnailDownload = await download(thumbnail.data.signedUrl);
  const detailDownload = await download(detailImage.data.signedUrl);
  console.log(JSON.stringify({ detailDownload, originalDownload, signElapsedMs, thumbnailDownload }, null, 2));
}
