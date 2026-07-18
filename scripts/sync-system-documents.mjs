import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const envIndex = process.argv.indexOf('--env');
const target = envIndex >= 0 ? process.argv[envIndex + 1] : 'development';

if (!['development', 'production'].includes(target)) {
  throw new Error('请使用 --env development 或 --env production。');
}
if (target === 'production' && !args.has('--allow-production')) {
  throw new Error('正式环境同步必须显式增加 --allow-production。');
}

const readEnvFile = (filePath) => {
  const values = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
};

const envFilePath = path.join(root, `.env.${target}.local`);
const fileEnv = existsSync(envFilePath) ? readEnvFile(envFilePath) : {};
const readConfig = (name) => process.env[name] || fileEnv[name] || '';
const supabaseUrl = readConfig('VITE_SUPABASE_URL');
const anonKey = readConfig('VITE_SUPABASE_ANON_KEY');
const expectedRef = readConfig(target === 'development' ? 'STOREHUB_DEVELOPMENT_SUPABASE_REF' : 'STOREHUB_PRODUCTION_SUPABASE_REF');
const actualRef = (() => { try { return new URL(supabaseUrl).hostname.split('.')[0]; } catch { return ''; } })();

if (!supabaseUrl || !anonKey || !expectedRef || actualRef !== expectedRef) {
  throw new Error(`${target} 说明文档同步环境校验失败，已阻止上传。`);
}

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const client = createClient(supabaseUrl, serviceRoleKey || anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
let updatedBy = null;

if (!serviceRoleKey) {
  const identifier = process.env.STOREHUB_DOCUMENT_ADMIN_IDENTIFIER || '';
  const password = process.env.STOREHUB_DOCUMENT_ADMIN_PASSWORD || '';
  if (!identifier || !password) {
    throw new Error('请临时设置 STOREHUB_DOCUMENT_ADMIN_IDENTIFIER 和 STOREHUB_DOCUMENT_ADMIN_PASSWORD，或提供 SUPABASE_SERVICE_ROLE_KEY。');
  }
  const response = await globalThis.fetch(`${supabaseUrl}/functions/v1/account-login`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const result = await response.json();
  if (!response.ok || !result.accessToken || !result.refreshToken) throw new Error(result.error || '管理员账号登录失败，无法同步说明文档。');
  const session = await client.auth.setSession({ access_token: result.accessToken, refresh_token: result.refreshToken });
  if (session.error || !session.data.user) throw new Error(session.error?.message || '无法建立说明文档同步会话。');
  updatedBy = session.data.user.id;
}

const packageVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const documents = [
  {
    audience: 'staff_manager',
    file: '门店运营系统_员工与店长使用说明.html',
    slug: 'staff-manager-guide',
    summary: '登录、点货订货、到货上报、任务、公告、SOP、历史记录和账号使用说明。',
    title: '员工与店长使用说明',
  },
  {
    audience: 'admin',
    file: '门店运营系统_管理员使用说明.html',
    slug: 'admin-guide',
    summary: '任务、到货、货品、账号、公告、SOP、运营统计和归档管理说明。',
    title: '管理员使用说明',
  },
];

for (const document of documents) {
  const contentHtml = readFileSync(path.join(root, 'docs', document.file), 'utf8');
  if (!/^<!doctype html>/i.test(contentHtml.trim())) throw new Error(`${document.file} 不是完整 HTML 文档。`);
  const row = {
    audience: document.audience,
    content_html: contentHtml,
    document_version: packageVersion,
    slug: document.slug,
    summary: document.summary,
    title: document.title,
    ...(updatedBy ? { updated_by: updatedBy } : {}),
  };
  const { error } = await client.from('v2_system_documents').upsert(row, { onConflict: 'slug' });
  if (error) throw new Error(`${document.title} 上传失败：${error.message}`);
  console.log(`已同步：${document.title}（${Buffer.byteLength(contentHtml, 'utf8')} 字节）`);
}

console.log(`系统说明文档同步完成：${target} (${actualRef})，版本 ${packageVersion}。`);
