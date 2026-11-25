# 基础设施、凭据与运维手册

截至 2026-11-25。先读 [接手总指南](../AGENT_HANDOVER.md)。本文只登记可安全分享的位置、字段名和用途，不携带可直接使用的 API Key、密码、私钥或员工个人资料。

## 1. 安全复用已有凭据

用户希望已有配置直接复用，无需反复重新填写。新 agent 在这台电脑上具备相应权限时，按下面索引在内存中读取；换电脑/换执行主机时，需要通过用户认可的私有文件传输或秘密管理工具交付，不能只拿本 Markdown 就认为密钥也随 Git 搬走了。

| 凭据/配置 | 现有位置 | 用途/注意 |
|---|---|---|
| 正式后端 JWT / anon / service 等 | `D:\codex_develop\storehub-local-production\public-backend-secrets.json` | 文件名虽叫 local，当前构建/验证包装器仍从此处读取；实际业务数据在云端。当前键名见附录。写入或轮换前须与云端确认 |
| 测试后端 JWT / anon / service 等 | `D:\codex_develop\storehub-local-development\public-backend-secrets.json` | 与正式隔离，禁止混用 |
| 正式数据库 / Realtime 运行秘密 | `D:\codex_develop\storehub-tencent-production\runtime-secrets.json` | 包含 databasePassword、realtimeAdminKey、tenantJWTSecret；历史本机副本不是实时秘密管理平台 |
| 正式源站秘密 | `D:\codex_develop\storehub-tencent-production\cloud-origin-secrets.json` | originToken、databasePassword；源站 token 与 Worker/Nginx 必须匹配 |
| 测试云端私有部署材料 | `D:\codex_develop\storehub-tencent-development` | 单独查该环境配置，不拿正式 secrets 覆盖 |
| SSH 部署私钥 | `D:\codex_develop\storehub-tencent-production\deploy_ed25519` | 公钥同名 .pub；主机指纹 `known_hosts`，必须严格核对，不关闭 host key checking |
| 双环境钉钉企业配置 | `D:\codex_develop\storehub-tencent-production\dingtalk-enterprises.private.json` | production/development 数组，AppKey/AppSecret/CorpId；可能有旧提取副本，优先核对当前运行配置 |
| 单企业历史凭据快照 | 同目录 `dingtalk-app-*.private.json` | 用于追溯，不保证是当前应用；不打印内容 |
| 云端实际 Functions 凭据 | `/opt/storehub-production/compose.json`、`/opt/storehub-development/compose.json` 的 functions 环境及对应私有配置 | 当前备份确认两个 functions 服务有 `DINGTALK_ENTERPRISE_CONFIGS`；以运行配置为准，不假定旧本地 JSON 最新 |
| 银豹 | 服务端 `POSPAL_INTEGRATIONS_BASE64`，或原私有导出与部署配置 | 编码 JSON 存 storeId/host/appId/appKey；Base64 不是加密。当前是否启用需看运行设置/任务状态 |
| 企迈 | 服务端 `QMAI_INTEGRATIONS_BASE64`，或既有私有配置 | credentialId/openId/grantCode/openKey，与业务门店映射分离；`qmai-cli-main` 是辅助目录，不是当前系统后端 |
| AI 提供商 | 数据库受保护 provider 配置，经 `service_get_ai_provider_config` 由服务端读取；兼容 `DEEPSEEK_API_KEY` 备用环境变量 | `supabase/functions/ai-review/index.ts` 是选择逻辑；不要调用该 RPC 把明文结果贴到日志，不调用付费模型做连通测试 |
| Cron 凭据 | 各环境数据库私有配置/运行配置及备份 | 同步考勤、营业收入使用服务端专用 token；不得进入前端环境变量或交接文档 |
| Cloudflare OAuth/API | 本机 Wrangler 的私有用户配置，或当前进程安全注入 | 仓库不保存可用 CF token；先用已有登录，确需重新登录时再让用户参与，不创建新的多余 token |
| Pages 绑定 | 控制台各项目的运行时变量/secret | DEV/PROD backend origin、origin token 各自分离；下节列字段名 |
| Android 签名 | `C:\Users\hwson\.storehub\android\storehub-release.jks` 及同目录 `signing.properties` | 项目 `android/signing.properties` 为本地未跟踪配置入口；密码不进 Git；覆盖升级必须沿用同一签名 |
| 本地备份专用私钥 | `D:\StoreHubBackups\config\backup_ed25519` | 仅允许只读强制命令，不是日常部署 SSH 身份；`backup.json` 与 `known_hosts` 在同目录 |
| 源托管 Supabase S3 凭据 | `D:\codex_develop\storehub-local-production\cloud-s3-credentials.json` 等历史导出 | 仅历史补图时使用，是否仍有效未知；数据库 Key 不等于 S3 Access Key |

不能输出整个 `docker inspect`、整个 Compose、EntryPoint、Auth 环境或 SQL 备份：这些地方会嵌入 PostgreSQL 密码、JWT 和 pgSodium 根密钥。只输出白名单字段，例如容器名、镜像、健康状态、端口、日志限额、环境变量**名称**。

读取示例（只演示用法，不输出秘密）：

```javascript
const credentials = JSON.parse(readFileSync(privatePath, 'utf8'));
const client = createClient(site + '/backend', credentials.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// 检查响应状态/计数；不要 console.log(credentials)、会话或业务人员资料。
```

如果“有 api key 但服务仍不可用”，先分清它是哪种凭据：anon、service-role、数据库密码、平台管理 token、S3 Access Key、第三方 AppSecret、模型 Key 不能互换。JWT 轮换会影响登录会话、网关、Auth、REST、Storage、Realtime 与构建指纹，不可只换一处。

## 2. Cloudflare Pages 与源站

| 配置名 | 放置位置 | 是否可进浏览器 |
|---|---|---|
| `VITE_APP_ENV` | 对应环境构建 | 是，development/production |
| `VITE_SUPABASE_URL` | 对应环境构建 | 是，当前为对应站点 `/backend` |
| `VITE_SUPABASE_ANON_KEY` | 对应环境构建的未跟踪 env/CI | 只公开受 RLS 约束的 anon，仓库不收集真实值 |
| `STOREHUB_PRODUCTION_SUPABASE_REF` / `STOREHUB_DEVELOPMENT_SUPABASE_REF` | 环境门禁 | 公开项目标识，不是密钥 |
| `STOREHUB_DEV_BACKEND_ORIGIN` / `STOREHUB_PROD_BACKEND_ORIGIN` | Pages Worker runtime | 不作为 VITE 值发送 |
| `STOREHUB_DEV_ORIGIN_TOKEN` / `STOREHUB_PROD_ORIGIN_TOKEN` | Pages Worker secret | 否；Worker 去除客户端伪造同名 header 后重新注入 |
| `STOREHUB_MIGRATION_CHECK_CONFIG` | 本机发布进程 | 否；指向私有 SSH 登记 JSON |
| `STOREHUB_BUILD_SHA` / `STOREHUB_GIT_BRANCH` | 构建进程 | 记录提交和环境，勿伪造 |

旧项目 ref：正式 `mxxxpyowccezplfeffms`，测试 `tpbjlzmxpxsydsheeswm`，现还用于门禁登记。Key 指纹见 `config/environment-policy.json`。不要把受限旧托管项目当成当前业务服务。

`public/_worker.js` 只允许 `/auth|rest|storage|functions|realtime/v1` 等合法路径，特定 realtime websocket/broadcast 路径有白名单。只接受登记的 `sslip.io` 源站或旧迁移 `trycloudflare` 规则；域名变化须同步代码与配置。WebSocket 101 要保留原响应对象。

静态产物 `dist` 包含 Worker/headers/routes/version；仅替换 JS chunk 不等于完整发布。API 代理响应当前 no-store，私有图片性能主要依靠前端图片缓存/本地 Blob 与 imgproxy，不能直接把全部受权图片设为公共 CDN 缓存。

## 3. 腾讯云运行路径

SSH 示例：

```powershell
ssh -i D:/codex_develop/storehub-tencent-production/deploy_ed25519 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=D:/codex_develop/storehub-tencent-production/known_hosts ubuntu@43.163.113.19
```

| 路径/对象 | 含义 |
|---|---|
| `/opt/storehub-production/compose.json` | 正式真实 Compose，含秘密，不输出全文 |
| `/opt/storehub-development/compose.json` | 测试真实 Compose |
| `/opt/storehub-<env>/functions` | 实际函数源代码只读挂载的主机目录 |
| `/opt/storehub-<env>/public-gateway.json` | Kong 声明式路由/访问配置，可能含 key |
| `/opt/storehub-<env>/runtime-secrets.json`、`cloud-origin-secrets.json` | 运行秘密（按实际存在文件为准） |
| `/opt/storehub-production/nginx-http.conf` 等实际 Nginx 文件 | 两个环境合并的 HTTPS/HTTP 入口；不要被旧单环境脚本覆盖 |
| `/opt/storehub-production/letsencrypt` | 证书及私钥目录；备份包含相关配置 |
| `/opt/storehub-production/backups`、`/opt/storehub-development/backups` | 退休前历史备份，不能当在线业务数据；不再生成定时备份 |
| `/opt/storehub-production/retired-cloud-backup-units` | 原四个备份 service/timer 文件留档 |
| `/usr/local/lib/storehub-backup-bridge.py` | root 所有的只读导出器，受限 SSH 公钥调用 |
| `/var/lib/docker/volumes/supabase_db_storehub-local-<env>/_data` | 在线 PostgreSQL 数据，不能直接删除/覆盖/文件级热复制做恢复 |
| `/var/lib/docker/volumes/supabase_storage_storehub-local-<env>/_data` | 在线 Storage 文件，必须保留内部布局、版本目录、权限及 xattrs |
| `/etc/postgresql-custom/pgsodium_root.key`（数据库容器内） | 数据库加密根密钥，单独随本地快照保存，不打印 |

两环境各 8 个服务（数据库、Auth、REST、Storage、Functions、Realtime、Kong、imgproxy），镜像与挂载详细清单见本文末尾的快照配置附录。

云端检查只读取最小信息：

```bash
df -h /
sudo docker ps --format '{{.Names}} {{.Status}}'
sudo docker compose -f /opt/storehub-production/compose.json ps
sudo docker compose -f /opt/storehub-development/compose.json ps
sudo systemctl is-enabled storehub-backup.timer storehub-development-backup.timer
sudo systemctl status storehub-cert-renew.timer --no-pager
```

数据库只读检查示例（指定环境，避免复制到错容器）：

```bash
sudo docker exec -i supabase_db_storehub-local-development psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1
```

通过 stdin 传 `begin read only; ...; rollback;`。不要依赖普通 `postgres` 角色具有所有 Supabase 管理权限；恢复/全局角色操作使用原受控管理身份。不要把 SQL body 动态拼成未经转义的 shell 参数。

## 4. 证书、计划任务与磁盘

- Let’s Encrypt 免费证书，`storehub-cert-renew.timer` 负责续期；保留 80/443，核对当前证书有效期。旧文档写的 2027-01-11 是当时检查值，不当成永久值。
- Cloud 备份四单元必须 masked/inactive：`storehub-backup.service/.timer`、`storehub-development-backup.service/.timer`。不要为迁移启动它们。
- 业务数据库 cron（考勤、任务、营业收入、工资等）与备份 timer 不同；不能为了“关备份”停掉全部 cron。
- 测试/正式 cron 启用情况独立。不要把正式启用的自动任务复制到测试环境。
- 16 个容器 `json-file` 10m×3 日志限额；Docker 重新创建会影响服务，修改前强制本地备份、检查实际卷/网络/密钥并有回退方案。
- 2026-11-24 维护后磁盘约 50% 使用、33GiB 可用，是历史检查值；每次维护重新看 `df`。

## 5. 当前本地备份文件与恢复工具

| 位置 | 说明 |
|---|---|
| `D:\StoreHubBackups\backup-status.json` | 总状态及两环境本次快照、时间、hash、文件数 |
| `production\latest.json` / `development\latest.json` | 最近完整快照索引 |
| `<env>\snapshots\<时间戳-随机标识>` | 数据库、角色、配置、加密根密钥、图片清单及校验元信息 |
| `<env>\blobs\<hash前两位>\<SHA256>` | 图片原内容，多个快照引用同一份 |
| `<env>\pending` | 失败/进行中的快照；未验证内容不能冒充成功副本 |
| `bin\local-backup.py` | 拉取、哈希、断点复用、轮换、verify |
| `bin\run-local-backup.ps1` | Windows 隐藏执行与失败重试 |
| `bin\restore-local-storage.py` | Linux 空目录恢复文件/权限/xattrs |
| `logs` | 每次 Windows runner 日志；不记录秘密 |
| `verification` | 恢复与开机任务结果；报告也是特定时点证据 |

只读校验：

```powershell
& C:/Users/hwson/AppData/Local/Programs/Python/Python312/python.exe D:/StoreHubBackups/bin/local-backup.py --config D:/StoreHubBackups/config/backup.json --verify
```

注意 verify 会更新总状态时间/运行信息，不触发业务接口写入。恢复执行例子见 `python ops/restore-local-storage.py --help`；目标必须新的空目录。恢复完整环境还需要同版本数据库镜像、角色、运行配置和加密根密钥，不能只有图片文件。

本地旧 `start-online.ps1` / `start-local.ps1` 有 cloud-cutover 保护；不要为了重启测试绕过保护，把 Pages 绑回本机或启动旧定时同步造成数据分叉。

## 6. 本次交接的验证口径

### 小程序配置与发布边界

`wechatapp/README.StoreHub.md` 是现有小程序适配说明：业务 React 源码复用，`tooling/` 为转换与兼容源码，`cloudfunctions/bridge/` 为固定后端目标的接口桥接。根目录原模板与未跟踪资料保留，不把生成的 `dist/` 当源码。

本地 `wechatapp/.local/development.json.local` 与 `production.json.local` 保存对应 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，不提交；`project.private.config.json`、上传密钥和登录凭据也不提交。已有文档登记免费 CloudBase 环境 `storehub-development-d7a8968dc20`，接手时核对实际环境，不擅自创建收费资源。

`pnpm wechat:check` 是发布门禁的一部分。`wechat:build`、`wechat:build:production`、`wechat:build:cloud` 只构建；小程序还需开发者工具编译、上传、发布与真机验证，不能把 Pages 部署成功当作微信版本已发布。相机、导出和真机 WebSocket 有独立验证边界，未测不能宣称全部角色与两设备同步正常。桥接必须保留小程序身份校验和原 StoreHub JWT/RLS，不开无鉴权 HTTP 路由。

### 本次核验范围

今日自动备份的配置副本用于核对容器镜像、挂载、日志和变量名称；文档不将其冒充实时 `docker inspect`。整理时 SSH TCP 建立后、服务端 banner/密钥交换前关闭，尚不能用本次 SSH 重新核验实时迁移历史。HTTP `/version.json` 仍可读取，但它本身不证明数据库可用；应分别记录 Auth/REST 状态。

发布门禁不应因此跳过 SSH。若本次不能恢复 SSH，文档可以在工作区交付，但不能声称新版本已双环境发布；保留明确待处理项。

<!-- SAFE_SNAPSHOT_APPENDIX -->

## 附录：今日备份中的实际镜像、端口与变量名

来源：2026-11-25 成功备份的 config.tar.gz 内 Compose。只取白名单，不含 Env 值、Entrypoint、命令、密码和 key。

### production

快照 `20261125T053312Z-5554b060`，配置/数据备份完成 `2026-11-25T05:35:59.611888+00:00`，Storage 文件 5986 个。

|服务/容器|镜像|主机端口|卷挂载|
|---|---|---|---|
|`supabase_db_storehub-local-production`|`public.ecr.aws/supabase/postgres:17.6.1.141`|无公开映射|supabase_db_storehub-local-production:/var/lib/postgresql/data|
|`storehub_prod_auth`|`public.ecr.aws/supabase/gotrue:v2.192.0`|无公开映射||
|`storehub_prod_rest`|`public.ecr.aws/supabase/postgrest:v14.14`|无公开映射||
|`storehub_prod_storage`|`public.ecr.aws/supabase/storage-api:v1.62.5`|无公开映射|supabase_storage_storehub-local-production:/mnt|
|`storehub_prod_functions`|`public.ecr.aws/supabase/edge-runtime:v1.74.2`|无公开映射|supabase_edge_runtime_storehub-local-production:/root/.cache/deno<br>/opt/storehub-production/functions:/codex_develop/storehub-local-production/supabase/functions:ro|
|`storehub-prod`|`public.ecr.aws/supabase/realtime:v2.112.6`|127.0.0.1:55334:4000||
|`storehub_prod_gateway`|`public.ecr.aws/supabase/kong:2.8.1`|127.0.0.1:55331:8000|/opt/storehub-production/public-gateway.json:/home/kong/public-gateway.json:ro|
|`storehub_prod_imgproxy`|`public.ecr.aws/supabase/imgproxy:v3.8.0`|无公开映射|supabase_storage_storehub-local-production:/mnt:ro|

各服务 json-file 日志均为 10m×3（以快照为准）。

- `supabase_db_storehub-local-production` 环境变量名：`GRN_PLUGINS_DIR`、`JWT_EXP`、`JWT_SECRET`、`LANG`、`LANGUAGE`、`LC_ALL`、`LOCALE_ARCHIVE`、`PATH`、`PGDATA`、`POSTGRES_DB`、`POSTGRES_HOST`、`POSTGRES_INITDB_ARGS`、`POSTGRES_PASSWORD`、`POSTGRES_USER`
- `storehub_prod_auth` 环境变量名：`API_EXTERNAL_URL`、`GOTRUE_API_HOST`、`GOTRUE_API_PORT`、`GOTRUE_DB_DATABASE_URL`、`GOTRUE_DB_DRIVER`、`GOTRUE_DB_MIGRATIONS_PATH`、`GOTRUE_DISABLE_SIGNUP`、`GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED`、`GOTRUE_EXTERNAL_APPLE_CLIENT_ID`、`GOTRUE_EXTERNAL_APPLE_EMAIL_OPTIONAL`、`GOTRUE_EXTERNAL_APPLE_ENABLED`、`GOTRUE_EXTERNAL_APPLE_REDIRECT_URI`、`GOTRUE_EXTERNAL_APPLE_SECRET`、`GOTRUE_EXTERNAL_APPLE_SKIP_NONCE_CHECK`、`GOTRUE_EXTERNAL_EMAIL_ENABLED`、`GOTRUE_EXTERNAL_PHONE_ENABLED`、`GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED`、`GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED`、`GOTRUE_JWT_ADMIN_ROLES`、`GOTRUE_JWT_AUD`、`GOTRUE_JWT_DEFAULT_GROUP_NAME`、`GOTRUE_JWT_EXP`、`GOTRUE_JWT_ISSUER`、`GOTRUE_JWT_SECRET`、`GOTRUE_JWT_VALID_METHODS`、`GOTRUE_MAILER_AUTOCONFIRM`、`GOTRUE_MAILER_OTP_EXP`、`GOTRUE_MAILER_OTP_LENGTH`、`GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED`、`GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED`、`GOTRUE_MAILER_URLPATHS_CONFIRMATION`、`GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE`、`GOTRUE_MAILER_URLPATHS_INVITE`、`GOTRUE_MAILER_URLPATHS_RECOVERY`、`GOTRUE_MFA_MAX_ENROLLED_FACTORS`、`GOTRUE_MFA_PHONE_ENROLL_ENABLED`、`GOTRUE_MFA_PHONE_VERIFY_ENABLED`、`GOTRUE_MFA_TOTP_ENROLL_ENABLED`、`GOTRUE_MFA_TOTP_VERIFY_ENABLED`、`GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED`、`GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED`、`GOTRUE_PASSWORD_MIN_LENGTH`、`GOTRUE_PASSWORD_REQUIRED_CHARACTERS`、`GOTRUE_RATE_LIMIT_ANONYMOUS_USERS`、`GOTRUE_RATE_LIMIT_EMAIL_SENT`、`GOTRUE_RATE_LIMIT_OTP`、`GOTRUE_RATE_LIMIT_SMS_SENT`、`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`、`GOTRUE_RATE_LIMIT_VERIFY`、`GOTRUE_RATE_LIMIT_WEB3`、`GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`、`GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL`、`GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED`、`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`、`GOTRUE_SITE_URL`、`GOTRUE_SMS_AUTOCONFIRM`、`GOTRUE_SMS_MAX_FREQUENCY`、`GOTRUE_SMS_OTP_EXP`、`GOTRUE_SMS_OTP_LENGTH`、`GOTRUE_SMS_TEMPLATE`、`GOTRUE_SMS_TEST_OTP`、`GOTRUE_SMTP_ADMIN_EMAIL`、`GOTRUE_SMTP_HOST`、`GOTRUE_SMTP_MAX_FREQUENCY`、`GOTRUE_SMTP_PORT`、`GOTRUE_SMTP_SENDER_NAME`、`GOTRUE_URI_ALLOW_LIST`、`PATH`
- `storehub_prod_rest` 环境变量名：`PGRST_ADMIN_SERVER_PORT`、`PGRST_DB_ANON_ROLE`、`PGRST_DB_EXTRA_SEARCH_PATH`、`PGRST_DB_MAX_ROWS`、`PGRST_DB_SCHEMAS`、`PGRST_DB_URI`、`PGRST_JWT_SECRET`
- `storehub_prod_storage` 环境变量名：`ANON_KEY`、`AUTH_JWT_SECRET`、`DATABASE_URL`、`DB_MIGRATIONS_FREEZE_AT`、`ENABLE_IMAGE_TRANSFORMATION`、`FILE_SIZE_LIMIT`、`FILE_STORAGE_BACKEND_PATH`、`GLOBAL_S3_BUCKET`、`IMGPROXY_URL`、`NODE_VERSION`、`PATH`、`S3_PROTOCOL_ACCESS_KEY_ID`、`S3_PROTOCOL_ACCESS_KEY_SECRET`、`S3_PROTOCOL_ENABLED`、`S3_PROTOCOL_PREFIX`、`SERVICE_KEY`、`SIGNED_UPLOAD_URL_EXPIRATION_TIME`、`STORAGE_BACKEND`、`STORAGE_S3_REGION`、`TENANT_ID`、`TUS_URL_PATH`、`UPLOAD_FILE_SIZE_LIMIT`、`UPLOAD_FILE_SIZE_LIMIT_STANDARD`、`VECTOR_BUCKET_PROVIDER`、`VECTOR_DATABASE_URL`、`VECTOR_ENABLED`、`VECTOR_STORE_MIGRATIONS_ENABLED`、`VERSION`、`YARN_VERSION`
- `storehub_prod_functions` 环境变量名：`DINGTALK_ENTERPRISE_CONFIGS`、`PATH`、`SUPABASE_ANON_KEY`、`SUPABASE_DB_URL`、`SUPABASE_INTERNAL_FUNCTIONS_CONFIG`、`SUPABASE_INTERNAL_HOST_PORT`、`SUPABASE_INTERNAL_JWT_SECRET`、`SUPABASE_INTERNAL_PUBLISHABLE_KEY`、`SUPABASE_INTERNAL_SECRET_KEY`、`SUPABASE_JWKS`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_URL`
- `storehub-prod` 环境变量名：`API_JWT_SECRET`、`APP_NAME`、`DB_AFTER_CONNECT_QUERY`、`DB_ENC_KEY`、`DB_HOST`、`DB_NAME`、`DB_PASSWORD`、`DB_PORT`、`DB_USER`、`DNS_NODES`、`ECTO_IPV6`、`ERL_AFLAGS`、`LANG`、`LANGUAGE`、`LC_ALL`、`MAX_HEADER_LENGTH`、`METRICS_JWT_SECRET`、`MIX_ENV`、`PATH`、`PORT`、`RLIMIT_NOFILE`、`RUN_JANITOR`、`SECRET_KEY_BASE`、`SEED_SELF_HOST`、`SLOT_NAME_SUFFIX`
- `storehub_prod_gateway` 环境变量名：`ASSET`、`KONG_ADMIN_LISTEN`、`KONG_DATABASE`、`KONG_DECLARATIVE_CONFIG`、`KONG_DNS_ORDER`、`KONG_NGINX_WORKER_PROCESSES`、`KONG_PLUGINS`、`KONG_PROXY_LISTEN`、`KONG_VERSION`、`PATH`
- `storehub_prod_imgproxy` 环境变量名：`IMGPROXY_ALLOWED_SOURCES`、`IMGPROXY_BIND`、`IMGPROXY_ENABLE_WEBP_DETECTION`、`IMGPROXY_LOCAL_FILESYSTEM_ROOT`、`IMGPROXY_USE_ETAG`、`LD_LIBRARY_PATH`、`MALLOC_ARENA_MAX`、`PATH`、`VIPS_WARNING`

### development

快照 `20261125T053607Z-7281f93a`，配置/数据备份完成 `2026-11-25T05:36:54.218688+00:00`，Storage 文件 313 个。

|服务/容器|镜像|主机端口|卷挂载|
|---|---|---|---|
|`supabase_db_storehub-local-development`|`public.ecr.aws/supabase/postgres:17.6.1.141`|无公开映射|supabase_db_storehub-local-development:/var/lib/postgresql/data|
|`storehub_dev_auth`|`public.ecr.aws/supabase/gotrue:v2.192.0`|无公开映射||
|`storehub_dev_rest`|`public.ecr.aws/supabase/postgrest:v14.14`|无公开映射||
|`storehub_dev_storage`|`public.ecr.aws/supabase/storage-api:v1.62.5`|无公开映射|supabase_storage_storehub-local-development:/mnt|
|`storehub_dev_functions`|`public.ecr.aws/supabase/edge-runtime:v1.74.2`|无公开映射|supabase_edge_runtime_storehub-local-development:/root/.cache/deno<br>/opt/storehub-development/functions:/codex_develop/storehub-local-development/supabase/functions:ro|
|`storehub-dev`|`public.ecr.aws/supabase/realtime:v2.112.6`|127.0.0.1:55324:4000||
|`storehub_dev_gateway`|`public.ecr.aws/supabase/kong:2.8.1`|127.0.0.1:55321:8000|/opt/storehub-development/public-gateway.json:/home/kong/public-gateway.json:ro|
|`storehub_dev_imgproxy`|`public.ecr.aws/supabase/imgproxy:v3.8.0`|无公开映射|supabase_storage_storehub-local-development:/mnt:ro|

各服务 json-file 日志均为 10m×3（以快照为准）。

- `supabase_db_storehub-local-development` 环境变量名：`GRN_PLUGINS_DIR`、`JWT_EXP`、`JWT_SECRET`、`LANG`、`LANGUAGE`、`LC_ALL`、`LOCALE_ARCHIVE`、`PATH`、`PGDATA`、`POSTGRES_DB`、`POSTGRES_HOST`、`POSTGRES_INITDB_ARGS`、`POSTGRES_PASSWORD`、`POSTGRES_USER`
- `storehub_dev_auth` 环境变量名：`API_EXTERNAL_URL`、`GOTRUE_API_HOST`、`GOTRUE_API_PORT`、`GOTRUE_DB_DATABASE_URL`、`GOTRUE_DB_DRIVER`、`GOTRUE_DB_MIGRATIONS_PATH`、`GOTRUE_DISABLE_SIGNUP`、`GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED`、`GOTRUE_EXTERNAL_APPLE_CLIENT_ID`、`GOTRUE_EXTERNAL_APPLE_EMAIL_OPTIONAL`、`GOTRUE_EXTERNAL_APPLE_ENABLED`、`GOTRUE_EXTERNAL_APPLE_REDIRECT_URI`、`GOTRUE_EXTERNAL_APPLE_SECRET`、`GOTRUE_EXTERNAL_APPLE_SKIP_NONCE_CHECK`、`GOTRUE_EXTERNAL_EMAIL_ENABLED`、`GOTRUE_EXTERNAL_PHONE_ENABLED`、`GOTRUE_EXTERNAL_WEB3_ETHEREUM_ENABLED`、`GOTRUE_EXTERNAL_WEB3_SOLANA_ENABLED`、`GOTRUE_JWT_ADMIN_ROLES`、`GOTRUE_JWT_AUD`、`GOTRUE_JWT_DEFAULT_GROUP_NAME`、`GOTRUE_JWT_EXP`、`GOTRUE_JWT_ISSUER`、`GOTRUE_JWT_SECRET`、`GOTRUE_JWT_VALID_METHODS`、`GOTRUE_MAILER_AUTOCONFIRM`、`GOTRUE_MAILER_OTP_EXP`、`GOTRUE_MAILER_OTP_LENGTH`、`GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED`、`GOTRUE_MAILER_TEMPLATE_RELOADING_ENABLED`、`GOTRUE_MAILER_URLPATHS_CONFIRMATION`、`GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE`、`GOTRUE_MAILER_URLPATHS_INVITE`、`GOTRUE_MAILER_URLPATHS_RECOVERY`、`GOTRUE_MFA_MAX_ENROLLED_FACTORS`、`GOTRUE_MFA_PHONE_ENROLL_ENABLED`、`GOTRUE_MFA_PHONE_VERIFY_ENABLED`、`GOTRUE_MFA_TOTP_ENROLL_ENABLED`、`GOTRUE_MFA_TOTP_VERIFY_ENABLED`、`GOTRUE_MFA_WEB_AUTHN_ENROLL_ENABLED`、`GOTRUE_MFA_WEB_AUTHN_VERIFY_ENABLED`、`GOTRUE_PASSWORD_MIN_LENGTH`、`GOTRUE_PASSWORD_REQUIRED_CHARACTERS`、`GOTRUE_RATE_LIMIT_ANONYMOUS_USERS`、`GOTRUE_RATE_LIMIT_EMAIL_SENT`、`GOTRUE_RATE_LIMIT_OTP`、`GOTRUE_RATE_LIMIT_SMS_SENT`、`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`、`GOTRUE_RATE_LIMIT_VERIFY`、`GOTRUE_RATE_LIMIT_WEB3`、`GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`、`GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL`、`GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED`、`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`、`GOTRUE_SITE_URL`、`GOTRUE_SMS_AUTOCONFIRM`、`GOTRUE_SMS_MAX_FREQUENCY`、`GOTRUE_SMS_OTP_EXP`、`GOTRUE_SMS_OTP_LENGTH`、`GOTRUE_SMS_TEMPLATE`、`GOTRUE_SMS_TEST_OTP`、`GOTRUE_SMTP_ADMIN_EMAIL`、`GOTRUE_SMTP_HOST`、`GOTRUE_SMTP_MAX_FREQUENCY`、`GOTRUE_SMTP_PORT`、`GOTRUE_SMTP_SENDER_NAME`、`GOTRUE_URI_ALLOW_LIST`、`PATH`
- `storehub_dev_rest` 环境变量名：`PGRST_ADMIN_SERVER_PORT`、`PGRST_DB_ANON_ROLE`、`PGRST_DB_EXTRA_SEARCH_PATH`、`PGRST_DB_MAX_ROWS`、`PGRST_DB_SCHEMAS`、`PGRST_DB_URI`、`PGRST_JWT_SECRET`
- `storehub_dev_storage` 环境变量名：`ANON_KEY`、`AUTH_JWT_SECRET`、`DATABASE_URL`、`DB_MIGRATIONS_FREEZE_AT`、`ENABLE_IMAGE_TRANSFORMATION`、`FILE_SIZE_LIMIT`、`FILE_STORAGE_BACKEND_PATH`、`GLOBAL_S3_BUCKET`、`IMGPROXY_URL`、`NODE_VERSION`、`PATH`、`S3_PROTOCOL_ACCESS_KEY_ID`、`S3_PROTOCOL_ACCESS_KEY_SECRET`、`S3_PROTOCOL_ENABLED`、`S3_PROTOCOL_PREFIX`、`SERVICE_KEY`、`SIGNED_UPLOAD_URL_EXPIRATION_TIME`、`STORAGE_BACKEND`、`STORAGE_S3_REGION`、`TENANT_ID`、`TUS_URL_PATH`、`UPLOAD_FILE_SIZE_LIMIT`、`UPLOAD_FILE_SIZE_LIMIT_STANDARD`、`VECTOR_BUCKET_PROVIDER`、`VECTOR_DATABASE_URL`、`VECTOR_ENABLED`、`VECTOR_STORE_MIGRATIONS_ENABLED`、`VERSION`、`YARN_VERSION`
- `storehub_dev_functions` 环境变量名：`DINGTALK_ENTERPRISE_CONFIGS`、`PATH`、`SUPABASE_ANON_KEY`、`SUPABASE_DB_URL`、`SUPABASE_INTERNAL_FUNCTIONS_CONFIG`、`SUPABASE_INTERNAL_HOST_PORT`、`SUPABASE_INTERNAL_JWT_SECRET`、`SUPABASE_INTERNAL_PUBLISHABLE_KEY`、`SUPABASE_INTERNAL_SECRET_KEY`、`SUPABASE_JWKS`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_URL`
- `storehub-dev` 环境变量名：`API_JWT_SECRET`、`APP_NAME`、`DB_AFTER_CONNECT_QUERY`、`DB_ENC_KEY`、`DB_HOST`、`DB_NAME`、`DB_PASSWORD`、`DB_PORT`、`DB_USER`、`DNS_NODES`、`ECTO_IPV6`、`ERL_AFLAGS`、`LANG`、`LANGUAGE`、`LC_ALL`、`MAX_HEADER_LENGTH`、`METRICS_JWT_SECRET`、`MIX_ENV`、`PATH`、`PORT`、`RLIMIT_NOFILE`、`RUN_JANITOR`、`SECRET_KEY_BASE`、`SEED_SELF_HOST`、`SLOT_NAME_SUFFIX`
- `storehub_dev_gateway` 环境变量名：`ASSET`、`KONG_ADMIN_LISTEN`、`KONG_DATABASE`、`KONG_DECLARATIVE_CONFIG`、`KONG_DNS_ORDER`、`KONG_NGINX_WORKER_PROCESSES`、`KONG_PLUGINS`、`KONG_PROXY_LISTEN`、`KONG_VERSION`、`PATH`
- `storehub_dev_imgproxy` 环境变量名：`IMGPROXY_ALLOWED_SOURCES`、`IMGPROXY_BIND`、`IMGPROXY_ENABLE_WEBP_DETECTION`、`IMGPROXY_LOCAL_FILESYSTEM_ROOT`、`IMGPROXY_USE_ETAG`、`LD_LIBRARY_PATH`、`MALLOC_ARENA_MAX`、`PATH`、`VIPS_WARNING`

### 已确认存在的本地私有文件字段名

这些是字段名称，本文不带值；本地副本与服务端实际值需按环境核对。

- `D:/codex_develop/storehub-tencent-production/runtime-secrets.json`：`databasePassword`、`realtimeAdminKey`、`tenantJWTSecret`
- `D:/codex_develop/storehub-tencent-production/cloud-origin-secrets.json`：`originToken`、`databasePassword`
- `D:/codex_develop/storehub-tencent-production/dingtalk-enterprises.private.json`：`production`、`development`
- `D:/codex_develop/storehub-tencent-production/migration-check-production.json`：`projectRef`、`container`、`host`、`user`、`identityFile`、`knownHostsFile`
- `D:/codex_develop/storehub-tencent-production/migration-check-development.json`：`projectRef`、`container`、`host`、`user`、`identityFile`、`knownHostsFile`
- `D:/codex_develop/storehub-local-production/public-backend-secrets.json`：`jwtSecret`、`anonKey`、`serviceKey`、`internalSecret`、`internalPublishable`、`realtimeSecret`、`realtimeAdminSecret`、`realtimeAdminKey`、`realtimeMetricsSecret`
- `D:/codex_develop/storehub-local-development/public-backend-secrets.json`：`jwtSecret`、`anonKey`、`serviceKey`、`internalSecret`、`internalPublishable`、`realtimeSecret`、`realtimeAdminSecret`、`realtimeAdminKey`、`realtimeMetricsSecret`
- `D:/StoreHubBackups/config/backup.json`：`root`、`host`、`sshExecutable`、`pythonExecutable`、`identityFile`、`knownHostsFile`、`keepSnapshots`、`minimumFreeBytes`、`seedDirectories`
