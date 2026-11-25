# StoreHub 部署说明

> 当前接手入口：[AGENT_HANDOVER.md](AGENT_HANDOVER.md) 与 [基础设施/凭据索引](handover/INFRASTRUCTURE.md)。下方保留托管 Supabase 时代的部署指令作历史参考；当前应采用腾讯云自托管迁移校验与函数发布流程，不要直接重新部署到旧托管项目。

## 当前备份方式：Windows 开机后拉取到本机

业务系统继续使用腾讯云数据库与图片，备份由本机独立执行，不依赖 Docker Desktop 或旧本地数据库。旧本地数据库仅是迁移时期的存档，不会自动同步云端新增记录。

- 本地根目录：`D:\StoreHubBackups`，正式版和测试版分别保存，目录 ACL 仅允许当前用户、SYSTEM 和管理员访问。
- 启动入口：Windows `StoreHub-LocalBackup` 当前用户登录触发的计划任务，执行 `bin\run-local-backup.ps1`。同一次开机成功后不重复运行；网络不可用时每 5 分钟重试，最多 12 次。临时强制备份使用该脚本的 `-Force`。
- 每份快照包含 PostgreSQL 自定义格式数据库转储、全局角色、数据库加密根密钥、服务配置及函数代码，以及全部图片/附件的文件清单。每个图片按 SHA-256 内容存放在 `blobs`，相同内容复用，首次备份可校验复用旧本地图片；不在 Windows 上直接展开 Linux 对象路径，因此保留长路径、大小写、非法 Windows 文件名和 Linux 扩展属性。
- 每个环境保留初始基线和最近 30 个成功快照。只在新快照完整校验成功后轮换并清理无引用的图片；中断时保留已成功下载的图片，不替换 `latest.json`。本地不足 10 GiB 余量时退出并保留旧快照。
- `backup-status.json` 显示状态，`production\latest.json` 和 `development\latest.json` 指向最近成功快照。私钥和连接配置只放在 `config`，不提交到 Git。

服务器安装 `ops/local-backup-bridge.py` 为 root 所有的 SSH 强制命令，专用公钥禁止 shell、PTY 和端口转发。仅允许两套固定环境的数据库、角色、配置和图片只读导出，数据经 SSH 流式传输，不在云服务器生成备份包。安装/更新本地程序时复制 `ops/local-backup.py`、`ops/run-local-backup.ps1`、`ops/restore-local-storage.py` 到本地 `bin`。

云端原备份的两个 `.service`、两个 `.timer` 已禁用并 mask。不得继续调用旧迁移脚本中的 `systemctl start storehub-backup.service`；迁移前先在本机强制拉取备份并核对状态。

恢复图片时先执行 `local-backup.py --config ... --verify`，再在 Linux 上运行 `restore-local-storage.py --backup-root <该环境目录> --snapshot <快照名> --target <新的空目录或卷>`，重建原始路径、权限和扩展属性。恢复数据库需使用相同 PostgreSQL/Supabase 版本及角色；验证实例必须断开外网并关闭 cron，禁止把旧快照直接覆盖在线数据。

## 已退役的云端备份维护工具

`ops/backup-cloud.sh` 和 `ops/maintain-backups.py` 仅保留为历史工具；以下为退役前的保留策略，当前不再由 timer 执行。

完整照片备份保留原始基线和最近最多 7 份，近期照片备份预算为每环境 18 GiB；至少保留两份近期完整恢复副本。数据库备份保留原始基线和最近 90 份。删除旧照片副本时保留该次数据库快照，并写入 `storage-pruned.json` 说明它只保留数据库。历史业务记录仍在在线数据库中，备份清理不触及在线数据卷。

备份前后均执行保留策略，两环境共用备份锁；可用空间须覆盖照片原始体积的 120% 并额外预留 2 GiB，否则退出并在 service 日志中报错。未完成的文件用 `.part` 写入，失败时清理，成功后才生成校验清单。只允许清理时间戳命名的已完成备份目录，忽略符号链接、不完整备份和其他文件。

所有 StoreHub Compose 服务设置 `json-file` 日志上限 `max-size=10m`、`max-file=3`。修改后需按环境重新创建容器使日志限额生效，保留原数据卷、密钥、环境变量和端口配置。部署后核对 Docker 实际 LogConfig，并验证账号登录、登录后数据访问和最新备份校验。

自托管环境发布时，设置 `STOREHUB_MIGRATION_CHECK_CONFIG` 指向当前环境登记的 SSH 主机、身份文件、主机密钥文件、容器和项目编号。环境门禁验证这些登记与分支、后端 URL 一致，随后通过 SSH 只读核对真实数据库迁移；此时不依赖已退役的 Supabase CLI 项目链接。未提供自托管配置时仍保留原 CLI 链接校验。

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
3. 正式发布必须提升版本号：日常修复可提升补丁版本 `x.y.z`，重大升级可提升到 `x.(y+1).0`；同时在 `src/config/version.ts` 和 `package.json` 保持一致，并在版本历史顶部填写本次中文更新摘要。
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

- 界面版本与 `package.json` 一致；`manage-system` 的每次合并都必须提升补丁版本，或将次版本号提高一级并把补丁位归零；
- 分支、应用环境、URL、Anon Key 和 CLI Link 的项目绑定；
- 新增 Migration 的编号、不可变历史和破坏性 SQL；
- 本地与当前远端 Migration 完全一致；
- Schema/RLS 静态规则与密钥扫描；
- TypeScript、ESLint、Vitest 和生产构建。

任何一步失败都不得继续部署。
