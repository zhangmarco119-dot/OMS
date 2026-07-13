# StoreHub 双 Supabase 环境隔离规范

## 1. 固定连接关系

| 项目 | `v2-development` | `manage-system` |
|---|---|---|
| `VITE_APP_ENV` | `development` | `production` |
| Supabase URL/Anon Key | 开发测试项目 | 正式项目 |
| Database / Auth / Storage | 开发独立数据 | 正式独立数据 |
| Seed | 允许显式执行开发 Seed | 禁止 |
| Cloudflare | 测试站点 | 正式站点 |

`config/environment-policy.json` 是项目编号和 Anon Key SHA-256 指纹白名单。构建脚本同时校验 Git/Cloudflare 分支、两个项目编号、Supabase URL、Anon Key 指纹、旧 JWT Key 可解析的所属项目以及本地 CLI Link。指纹不是密钥，不能还原真实 Key。

开发测试项目创建后，必须把其 20 位 Project Ref 填入 `developmentProjectRef`，并把开发 Anon Key 的 SHA-256 填入 `developmentAnonKeySha256`。在此之前，开发分支构建会有意失败，防止继续误连正式库。

## 2. 环境变量

两个环境都需要配置五个变量：

| 变量 | 开发值 | 正式值 |
|---|---|---|
| `VITE_APP_ENV` | `development` | `production` |
| `VITE_SUPABASE_URL` | 开发项目 URL | 正式项目 URL |
| `VITE_SUPABASE_ANON_KEY` | 开发项目 Anon/Publishable Key | 正式项目 Anon/Publishable Key |
| `STOREHUB_DEVELOPMENT_SUPABASE_REF` | 开发项目 Ref | 同一个开发项目 Ref |
| `STOREHUB_PRODUCTION_SUPABASE_REF` | 正式项目 Ref | 同一个正式项目 Ref |
| `STOREHUB_AUTH_SITE_URL` | 开发站点 HTTPS Origin | 正式站点 HTTPS Origin |
| `STOREHUB_AUTH_REDIRECT_URL` | 开发站点 HTTPS Origin | 正式站点 HTTPS Origin |

不要在前端或 Git 中保存数据库密码、Access Token、Service Role/Secret Key。Edge Function 的服务端 Secret 分别保存在各自 Supabase 项目中。

把真实 Key 写入未跟踪的 `.env.local` 后，可只输出不可逆指纹，再填入环境策略：

```powershell
node scripts/verify-environment.mjs --print-anon-key-fingerprint
```

## 3. Migration 唯一来源

- 所有结构、函数、RLS policy、Storage bucket/policy 变更都必须新增 `supabase/migrations/NNNN_name.sql`。
- 已提交或已应用的 Migration 禁止修改、删除、重命名。
- 新文件编号必须大于现有最大编号，且同一批次不重复。
- 发布 Migration 禁止出现 DROP TABLE/SCHEMA/DATABASE、TRUNCATE、直接 DELETE 测试数据。
- 需要数据修复时应设计可审计、可幂等且限定业务范围的专用 Migration，并单独评审。

`pnpm migrations:check` 只审查相对于发布基线新增/变更的 Migration，因此历史版本不会被重写。

## 4. 开发数据库先行

每一批数据库修改按以下顺序：

1. 在 `v2-development` 新增 Migration 和相应测试。
2. Link 开发测试项目并执行 `DryRun`。
3. Push 到开发测试项目，绝不使用 Seed 参数隐式带入测试数据。
4. 验证 Auth 角色、跨门店 RLS、Storage 上传/读取和实际业务流程。
5. 执行 `pnpm release:check`，确认远端 Migration 与仓库完全一致。

## 5. 合并与正式数据库

合并前 Codex 必须检查新增 Migration、RLS 静态验证、远端版本、类型、Lint、测试和构建。合并到本地 `manage-system` 后，正式前端仍不能先部署：

1. Link 正式项目并复核项目编号。
2. 对同一批 Migration 执行 Dry Run。
3. 使用显式确认字符串 Push 到正式库。
4. 再次执行 `pnpm release:check`。
5. 最后推送 `manage-system`，部署正式前端。

这个顺序确保新前端不会在正式数据库结构尚未就绪时上线。

## 6. Seed 与测试清理

- 唯一允许的测试 Seed 是 `supabase/seeds/development.sql`。
- 只能通过 `SeedDevelopment` 安全动作执行，脚本会同时验证分支、环境、项目编号和 CLI Link。
- 正式环境没有 Seed 动作。
- 正式库禁止 reset、seed、drop、truncate 或测试清理。任何正式数据删除都必须作为独立业务需求评审，不能混入发布流程。

## 7. Supabase 后台隔离

开发与正式项目应分别配置：

- Auth 用户、登录设置、Site URL 和 Redirect URL；
- Storage buckets、RLS policies 和文件对象；
- Edge Functions 及各自 Secrets；
- Database migrations、RLS 和业务数据。

不得从正式项目导出用户或业务数据作为开发测试数据。开发项目使用虚构账号和虚构门店数据。

## 8. 首次建立开发环境

1. 在 Supabase 新建空白项目，例如 `StoreHub Development`；不要从正式库备份恢复。
2. 在开发项目 Settings/API 复制 Project URL、Project Ref 和 Anon/Publishable Key。
3. 把真实 URL/Key 写入未跟踪的 `.env.development.local`，把两个 Ref 写入该文件的 `STOREHUB_*_REF`。
4. 生成开发 Key 指纹，把开发 Ref 与指纹提交到 `config/environment-policy.json`；真实 Key 不提交。
5. 在 `v2-development` 执行安全 Link、Migration Dry Run 和 Push。
6. 通过 `PushAuthConfig` 配置 Auth Site URL/Redirect URL 并关闭公开自助注册，再通过安全脚本部署 `account-login`、`admin-users`、`task-template-images`；Supabase 标准服务端变量由各项目独立提供，Storage bucket 与 policy 由 Migration 创建。
7. 创建虚构测试账号，并按需显式执行开发 Seed。

Cloudflare 推荐使用两个 Pages 项目：

- 开发 Pages 项目固定 `v2-development`，配置开发 URL/Key 和 `VITE_APP_ENV=development`；
- 正式 Pages 项目固定 `manage-system`，配置正式 URL/Key 和 `VITE_APP_ENV=production`。

两个 Pages 项目都要填写两个非密钥 Ref，构建时还会使用 Cloudflare 的 `CF_PAGES_BRANCH` 再次校验分支。
