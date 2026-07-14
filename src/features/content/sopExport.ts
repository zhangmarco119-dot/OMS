import { selectSopPreviewAsset } from './sopPreview';
import type { SopListItem } from '../../services/v2-content.service';

const escapeHtml = (value: string) => value
  .split('&').join('&amp;')
  .split('<').join('&lt;')
  .split('>').join('&gt;')
  .split('"').join('&quot;')
  .split("'").join('&#039;');

const formatDate = (value: string | null) => value
  ? new Date(value).toLocaleString('zh-CN', { hour12: false })
  : '立即生效';

const statusText: Record<SopListItem['status'], string> = {
  archived: '已归档',
  draft: '待发布',
  published: '已发布',
};

const blobToDataUrl = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
};

const loadEmbeddedAsset = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await blobToDataUrl(await response.blob());
  } catch {
    return null;
  }
};

type EmbeddedAsset = SopListItem['assetUrls'][number] & { dataUrl: string | null };

const renderSop = (sop: SopListItem, assets: EmbeddedAsset[], index: number, storeName: (id: string) => string) => {
  const steps = assets.filter((asset) => asset.asset_kind === 'step').sort((left, right) => left.sort_order - right.sort_order);
  const attachments = assets.filter((asset) => asset.asset_kind === 'attachment');
  const previewAsset = selectSopPreviewAsset(assets);
  const preview = previewAsset ? assets.find((asset) => asset.id === previewAsset.id) : null;
  const roles = sop.roles.map((role) => role === 'staff' ? '员工' : '店长').join('、') || '未设置';
  const stores = sop.storeIds.map(storeName).join('、') || '未设置';
  return `<article class="sop-page" id="sop-${index + 1}">
    <header class="sop-header">
      ${preview?.dataUrl ? `<img class="cover" src="${preview.dataUrl}" alt="${escapeHtml(sop.title)}预览图">` : '<div class="cover empty-cover">SOP</div>'}
      <div><p class="category">${escapeHtml(sop.category)}</p><h1>${escapeHtml(sop.title)}</h1><p class="meta">${statusText[sop.status]} · ${escapeHtml(stores)} · ${escapeHtml(roles)}</p><p class="meta">生效时间：${escapeHtml(formatDate(sop.effective_at))}</p></div>
    </header>
    ${sop.body ? `<section class="summary"><h2>整体说明</h2><p>${escapeHtml(sop.body).split('\n').join('<br>')}</p></section>` : ''}
    <section><h2>制作步骤（${steps.length}）</h2><div class="step-grid">${steps.map((asset, stepIndex) => `<figure class="step-card"><div class="step-number">步骤 ${stepIndex + 1}</div>${asset.dataUrl ? `<img src="${asset.dataUrl}" alt="步骤${stepIndex + 1}">` : '<div class="missing-image">图片未能写入导出文件</div>'}<figcaption>${escapeHtml(asset.step_text || `请按图示完成第 ${stepIndex + 1} 步。`).split('\n').join('<br>')}</figcaption></figure>`).join('')}</div></section>
    ${attachments.length ? `<section class="attachments"><h2>附件（${attachments.length}）</h2>${attachments.map((asset) => asset.dataUrl ? `<a href="${asset.dataUrl}" download="${escapeHtml(asset.file_name)}">${escapeHtml(asset.file_name)}</a>` : `<span>${escapeHtml(asset.file_name)}（未能写入）</span>`).join('')}</section>` : ''}
  </article>`;
};

export const buildSopCollectionHtml = async (sops: SopListItem[], storeName: (id: string) => string) => {
  const ordered = [...sops].sort((left, right) => left.category.localeCompare(right.category, 'zh-CN') || left.title.localeCompare(right.title, 'zh-CN'));
  const embedded = [] as Array<{ assets: EmbeddedAsset[]; sop: SopListItem }>;
  let missingAssetCount = 0;
  for (const sop of ordered) {
    const assets: EmbeddedAsset[] = [];
    for (const asset of sop.assetUrls) {
      const dataUrl = await loadEmbeddedAsset(asset.signedUrl);
      if (!dataUrl) missingAssetCount += 1;
      assets.push({ ...asset, dataUrl });
    }
    embedded.push({ assets, sop });
  }
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOP 合集</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eef3ef;color:#17251f;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;line-height:1.6}.document-cover,.sop-page{width:min(100%,210mm);margin:20px auto;background:#fff;padding:16mm;box-shadow:0 8px 30px #183d2c1a}.document-cover{min-height:260mm;display:flex;flex-direction:column;justify-content:center}.brand{color:#137c58;font-weight:800;letter-spacing:.08em}.document-cover h1{font-size:34px;margin:8px 0}.document-cover ol{padding-left:24px}.document-cover a{color:#146b50;text-decoration:none}.sop-header{display:grid;grid-template-columns:34mm 1fr;gap:14px;align-items:center;border-bottom:2px solid #dce9e1;padding-bottom:14px}.cover{width:34mm;height:34mm;border-radius:12px;object-fit:cover;background:#eef3ef}.empty-cover{display:grid;place-items:center;color:#137c58;font-weight:900;font-size:24px}.category{margin:0;color:#137c58;font-weight:800}.sop-header h1{font-size:26px;line-height:1.25;margin:3px 0}.meta{margin:2px 0;color:#617068;font-size:12px}.summary{margin:14px 0;padding:12px 14px;border-radius:10px;background:#f0f7f3}.summary p{margin:4px 0}.sop-page h2{font-size:16px;margin:14px 0 8px}.step-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.step-card{margin:0;border:1px solid #dce5df;border-radius:10px;overflow:hidden;break-inside:avoid}.step-number{padding:5px 8px;background:#e9f5ee;color:#116947;font-size:12px;font-weight:800}.step-card img,.missing-image{width:100%;aspect-ratio:4/3;object-fit:contain;background:#f6f8f7}.missing-image{display:grid;place-items:center;color:#8a4038;font-size:12px}.step-card figcaption{padding:8px;font-size:12px;line-height:1.55}.attachments{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.attachments h2{width:100%}.attachments a,.attachments span{border:1px solid #dce5df;border-radius:8px;padding:6px 10px;color:#146b50;font-size:12px}.footer-note{color:#687870;font-size:12px}@media(max-width:600px){.document-cover,.sop-page{margin:0;padding:18px;box-shadow:none}.sop-header{grid-template-columns:88px 1fr}.cover{width:88px;height:88px}.sop-header h1{font-size:21px}}@media print{body{background:#fff}.document-cover,.sop-page{width:100%;margin:0;box-shadow:none;break-after:page}.sop-page:last-child{break-after:auto}@page{size:A4;margin:0}}
  </style></head><body><section class="document-cover"><p class="brand">门店运营系统</p><h1>SOP 合集</h1><p>共 ${ordered.length} 份 · 导出时间 ${escapeHtml(generatedAt)}</p><ol>${ordered.map((sop, index) => `<li><a href="#sop-${index + 1}">${escapeHtml(sop.category)} · ${escapeHtml(sop.title)}</a></li>`).join('')}</ol><p class="footer-note">本文件已嵌入图片和附件，可离线查看；使用浏览器“打印”功能可另存为 PDF。</p></section>${embedded.map((entry, index) => renderSop(entry.sop, entry.assets, index, storeName)).join('')}</body></html>`;
  return { html, missingAssetCount };
};

export const downloadSopCollection = async (sops: SopListItem[], storeName: (id: string) => string) => {
  if (!sops.length) throw new Error('请至少勾选一份 SOP。');
  const result = await buildSopCollectionHtml(sops, storeName);
  const url = URL.createObjectURL(new Blob([result.html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  anchor.href = url;
  anchor.download = `SOP合集_${timestamp}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
  return result;
};
