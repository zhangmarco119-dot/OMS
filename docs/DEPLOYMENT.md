# StoreHub 部署说明

强制更新、两阶段启用和回滚操作见 [RELEASE_UPDATE_AND_ROLLBACK.md](./RELEASE_UPDATE_AND_ROLLBACK.md)。

StoreHub 只允许以下发布关系，详细安全规则见 [ENVIRONMENT_ISOLATION.md](./ENVIRONMENT_ISOLATION.md)。

| Git 分支 | 应用环境 | Supabase | Cloudflare 用途 |
|---|---|---|---|
| `v2-development` | `development` | 独立开发测试项目 | 测试站点/预览部署 |
| `manage-system` | `production` | 正式项目 | 正式站点 |

两个 Supabase 项目天然拥有独立的 Database、Auth 用户、Storage bucket 和 Edge Function 配置。禁止复制开发测试业务数据到正式项目。

## Cloudflare Pages 构建配置

- Production branch：正式站点项目使用 `manage-system`；测试站点项目使用 `v2-development`。
- Framework preset：`Vite`
- Build command：`pnpm build`
- Build output directory：`dist`
- Node.js：22 LTS

每个项目/分支都必须配置：

```text
VITE_APP_ENV
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
STOREHUB_PRODUCTION_SUPABASE_REF
STOREHUB_DEVELOPMENT_SUPABASE_REF
```

`STOREHUB_*_REF` 是公开的 20 位项目编号，不是密钥。真实 Anon Key 只能存入本地未跟踪环境文件或 Cloudflare 后台，不能提交到 Git；仓库只登记不可逆的 SHA-256 指纹用于识别连错的 Key。

## 开发测试发布

先在 `config/environment-policy.json` 登记两个项目编号和两个 Anon Key 指纹，并为 `v2-development` 配置开发项目变量：

```powershell
./scripts/supabase-environment.ps1 -Environment Development -Action Link
./scripts/supabase-environment.ps1 -Environment Development -Action DryRun
./scripts/supabase-environment.ps1 -Environment Development -Action Push
./scripts/supabase-environment.ps1 -Environment Development -Action PushAuthConfig -AuthSiteUrl https://oms-store-development.pages.dev -AuthRedirectUrl https://oms-store-development.pages.dev
./scripts/supabase-environment.ps1 -Environment Development -Action DeployFunctions
pnpm release:check
```

只有明确需要初始化演示数据时才执行：

```powershell
./scripts/supabase-environment.ps1 -Environment Development -Action SeedDevelopment -DevelopmentSeedConfirmation APPLY-DEVELOPMENT-SEED
```

Seed 只允许位于 `supabase/seeds/development.sql`，发布正式环境时绝不执行。

## 正式发布顺序

1. 在 `v2-development` 新增 Migration，并先应用到开发测试 Supabase。
2. 在开发项目完成 RLS、业务测试和 `pnpm release:check`。
3. 正式发布属于次版本升级：先在 `v2-development` 将 `src/config/version.ts` 和 `package.json` 从 `x.y.z` 提升到 `x.(y+1).0`，并在版本历史顶部填写本次中文更新摘要。每次合并到正式分支都必须提升次版本号。
4. 将已经完成版本升级的 `v2-development` 合并到本地 `manage-system`，此时先不要推送正式分支。
5. 切换本地正式环境变量，并安全 Link 正式 Supabase。
6. 对正式项目执行 Dry Run，再显式确认 Push：

```powershell
./scripts/supabase-environment.ps1 -Environment Production -Action Link
./scripts/supabase-environment.ps1 -Environment Production -Action DryRun
./scripts/supabase-environment.ps1 -Environment Production -Action Push -ProductionConfirmation APPLY-PRODUCTION-MIGRATIONS
pnpm release:check
```

7. 若 Edge Function 有变化，使用安全脚本部署 `account-login`、`admin-users` 和 `task-template-images`：

```powershell
./scripts/supabase-environment.ps1 -Environment Production -Action DeployFunctions -ProductionFunctionConfirmation DEPLOY-PRODUCTION-FUNCTIONS
```

脚本会对 `account-login` 使用 `--no-verify-jwt`，并在部署前复核分支、项目编号和 CLI Link。

8. 正式库 Migration、版本次级升级规则和全部门禁通过后，才推送 `manage-system`，触发正式前端部署。

禁止在正式项目执行 `db reset`、Seed、DROP、TRUNCATE、测试清理或批量删除业务数据。

## 本地预览

复制 `.env.example` 为未跟踪的 `.env.local`，填入当前分支对应项目后运行：

```powershell
pnpm dev
```

本机打开 `http://localhost:5173/app`。手机预览需要与电脑处于同一网络，再访问电脑 IPv4 地址的 5173 端口。

## 发布门禁内容

`pnpm release:check` 会依次校验：

- 界面版本与 `package.json` 一致；`manage-system` 的每次合并都必须将次版本号提高一级并把补丁位归零；
- 分支、应用环境、URL、Anon Key 和 CLI Link 的项目绑定；
- 新增 Migration 的编号、不可变历史和破坏性 SQL；
- 本地与当前远端 Migration 完全一致；
- Schema/RLS 静态规则与密钥扫描；
- TypeScript、ESLint、Vitest 和生产构建。

任何一步失败都不得继续部署。
