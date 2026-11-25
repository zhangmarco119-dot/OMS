# StoreHub 项目接手总指南

整理日期：2026-11-25（北京时间）。适用工作区：`D:\codex_develop\manage_system`。本文件面向接手开发与运维的 agent，不是软件内员工使用说明。

交接状态：本次文档变更准备版本为 3.0.75；整理时线上仍是 3.0.74。测试发布门禁在远端 Migration 核对阶段遇到 SSH 握手前关闭而失败，未绕过检查，也未将文档准备版本描述为已上线。恢复 SSH 后应对最终测试提交和正式合并提交分别重跑门禁，再完成双环境发布。

## 1. 接手先读与事实来源

1. 先读仓库根目录 [AGENTS.md](../AGENTS.md)，它规定备份、双环境发布、Android 与图片加载的强制要求。
2. 读本指南，确认当前后端在哪里、目标分支是什么、哪些旧文档已经过时。
3. 按任务读 [业务与交互约定](handover/BUSINESS_RULES.md)、[代码、路由与数据库索引](handover/CODE_MAP.md)、[基础设施与凭据索引](handover/INFRASTRUCTURE.md)。
4. [完整更新记录](handover/RELEASE_HISTORY.md) 保留版本日期、标题及摘要。具体实现以对应 Git 提交、迁移和测试为准。
5. [工作区文件索引](handover/WORKSPACE_INDEX.md) 区分源代码、辅助目录、历史材料和私有运维资料；不要把现有目录当临时垃圾清理。

事实优先级：用户当前要求和 AGENTS → 当前代码及真实云端状态 → 最新成功备份/验证记录 → 新交接指南 → 专项文档 → 早期 PRD/阶段计划。旧文档记录的是当时状态，不能机械执行其中的部署、清理、恢复命令。

**当前系统已是腾讯云上自托管的 Supabase 兼容服务栈，不是原生 Fastify 重写方案，也不再依赖本机 Docker 或本机隧道对外提供服务。** 先前讨论过的架构方案不等于已实施事实。

## 2. 当前部署总览

| 项目 | 正式版 | 测试版 |
|---|---|---|
| Git 分支 | `manage-system` | `v2-development` |
| 前端 / Android 页面 | <https://oms-store-management.pages.dev> | <https://oms-store-development.pages.dev> |
| 浏览器后端入口 | `https://oms-store-management.pages.dev/backend` | `https://oms-store-development.pages.dev/backend` |
| Cloudflare Pages 项目 | `oms-store-management` | `oms-store-development` |
| 腾讯云目录 | `/opt/storehub-production` | `/opt/storehub-development` |
| 数据库容器 | `supabase_db_storehub-local-production` | `supabase_db_storehub-local-development` |
| HTTPS 源站 | `https://storehub-prod.43-163-113-19.sslip.io` | `https://storehub-dev.43-163-113-19.sslip.io` |
| 网关回环端口 | `127.0.0.1:55331` | `127.0.0.1:55321` |
| Realtime 回环端口 | `127.0.0.1:55334` | `127.0.0.1:55324` |

两环境在同一台腾讯云新加坡服务器 `43.163.113.19`，SSH 用户 `ubuntu`；独立数据库、认证密钥、Docker 网络、存储卷和业务数据，但不是独立故障域。历史控制台截图为 Ubuntu 24.04、2 核 4GB、70GB 系统盘；续费状态及剩余额度应在控制台重新核实，不能沿用旧文档中的到期日。

请求链路：浏览器/Android → Cloudflare Pages 的 `public/_worker.js` → 带源站访问令牌的 HTTPS → Nginx → Kong → Auth / REST / Storage / Edge Functions / Realtime → PostgreSQL / Docker 存储卷。源站令牌只由 Worker 注入，不能发给前端。

仅业务 API 前缀通过 `/backend` 代理；Studio、SQL 管理接口、数据库、PostgREST 管理端口不能公开。不要开放公网 5432，也不要将回环端口改成 `0.0.0.0`。

整理开始时两个站点公开版本均为 **3.0.74**：正式 `3.0.74+405cca445951`，测试 `3.0.74+90f2d256e236`。这只是基线；接手时重新读取两个 `/version.json`，不要把本文版本常量当最新部署状态。

## 3. 本地工作区与技术结构

- Git：<https://github.com/zhangmarco119-dot/OMS.git>。`main` 是旧分支，不能替代两个正式发布分支。
- 前端：React 18、TypeScript strict、Vite 5、React Router 6、Tailwind、Lucide、React Hook Form/Zod、SheetJS。使用 pnpm 和锁文件，不混用 npm install 改锁文件。
- `src/main.tsx` 入口，`src/router.tsx` 是实际路由清单；没有 `src/App.tsx` 作为主路由入口。
- `src/pages` 页面；`src/services` 查询/RPC/上传封装；`src/features` 领域逻辑与复用界面；`src/components` 通用交互；`src/lib` 缓存、错误、环境、导航等基础能力。
- `supabase/migrations` 是数据库增量变更唯一来源，整理时最新编号 `0188_server_task_batch_review.sql`；不要修改已应用的历史迁移。
- `supabase/functions` 保存考勤、收银、登录、账号、图片和 AI 服务代码；当前由云端 edge-runtime 执行，不意味着仍由托管 Supabase 部署。
- `src/types/database.ts` 是数据库类型接口，不等于在线数据库完整 DDL；变更必须同步类型、RPC 调用和测试。
- `public/_worker.js`、`_routes.json`、`_headers` 是 Cloudflare 发布的一部分，不能只上传 assets。`version.json` 在构建时生成。
- `android` 是 WebView 外壳；`wechatapp` 是单独的小程序桥接与适配目录，当前含未跟踪的用户文件，不能删除或重新初始化。
- `ops` 是当前备份及历史维护工具；`scripts` 是环境隔离、发布、验证、构建与 smoke 工具。

原始 PRD、V2 分阶段文档对理解模型有帮助，但 `docs/ARCHITECTURE.md` 仍有“尚未建仓库/第一阶段骨架”等早期描述，`DATABASE.md` 也不是完整最新字段字典。本指南和索引专门补足这些历史偏差。

## 4. 产品与权限边界

系统服务宝珠奶酪五道口与 OMEGA 酸奶西直门等已配置门店。角色为 `staff`、`manager`、`admin`；兼职是员工计薪/人员配置维度，不是另一个登录角色。

- 管理员只能操作 `admin_store_access` 授权门店，不能因 role=admin 绕过全部门店范围。
- 多门店账号用 `profile_store_access`；`profiles.store_id` 是当前选中门店，历史归属还要按生效日期判断。
- 普通员工/店长的考勤、工资可见范围比商品管理更严格，通常只允许看本人；不能直接复用店长管理店内商品的权限。
- Auth 是唯一登录身份。钉钉只提供目录、排班、打卡与考勤；不要增加钉钉登录替代现有账号体系。
- 数据隔离必须在 RLS、受控 RPC 和函数鉴权落实，隐藏前端按钮不能替代权限控制。
- V1 点货/订货 `tasks/task_items` 与 V2 模板发布任务 `v2_*` 同时存在；修复任一模块不要误改另一套流程。
- 已提交单据、工资单、任务模板版本保存快照；商品改名、归档、离职、关店不能破坏历史可读性。

业务细则见 [BUSINESS_RULES.md](handover/BUSINESS_RULES.md)，其中明确了零元罚款、局部驳回、归档恢复、工资折算、人员税务联动等容易回归的需求。

## 5. 用户长期开发习惯

- 用户希望直接完成已授权的实现、排查、验证与双环境发布，少重复确认。缺必要信息时先做不依赖该信息的工作。
- 默认中文交流；进度说明应短而具体，结束时说明结果、验证与实际限制，不把计划描述为完成。
- 移动端优先，卡片整体可点击时不另加冗余“查看详情”按钮；操作位置符合连续录入习惯。
- 保存、上传、增删条目不应刷新整页、丢失焦点、重排列表或跳回顶部。新增条目向下追加；保留输入和滚动位置。
- 批量审批、点货局部选择的勾选框仅在进入选择模式时出现。
- 用户不希望员工端展示管理员计算过程、配置来源、开发讨论或本次需求说明；员工侧以业务结果为主。
- 工时术语：全职使用“自主延时工作登记/自主登记延时工作”，兼职使用“兼职工时”。代码/历史表名 `overtime` 可保留兼容，不应机械改库名；用户界面不得显示旧称呼，也不要增加“禁止某字眼”的说明。
- AI 功能入口应稳定可见且遵循权限/开关；排查与验收不调用付费 AI，不消耗系统保存的模型 API Key token，除非用户另行明确授权。
- 不把真实身份证、银行卡、密码、员工工资和第三方密钥复制到交接文档、Git 或测试截图。已给出的私有文件应直接安全读取复用，避免反复要求用户重新填写。
- 保留工作树里与任务无关的文件；只暂存本次精确文件，避免 `git add .`。
- 不创建新业务架构、新数据库、第二套 Android 页面来绕过已有实现。

## 6. 环境准备与常用检查

```powershell
Set-Location D:\codex_develop\manage_system
git status --short
git branch --show-current
node --version
pnpm --version
python --version
```

本机已找到 Node、pnpm、Python 3.12、Windows OpenSSH；PATH 失效时用 `scripts/use-pnpm.ps1` 或 Codex bundled runtime。以前文档中的固定 runtime 路径可能随安装变化。Python 当前为 `C:\Users\hwson\AppData\Local\Programs\Python\Python312\python.exe`，SSH 为 `C:\Windows\System32\OpenSSH\ssh.exe`。

`.env.local`、`.env.development.local`、`.env.production.local` 均不跟踪。不要输出它们的全部内容。`.env.example` 中的托管 Supabase URL 是示例，不是现在应填的腾讯云入口。Vite 的 mode、进程环境、分支绑定都要核对，尤其不能仅切 Git 分支后就运行默认 production build。

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

以上是日常局部检查；正式门禁用下一节。领域测试覆盖 RLS 静态规则、RPC、页面、图片、环境隔离、小程序与发布校验。新增图片页面必须补“正文先显示、图片单独加载/失败”测试；不要只测试实现自己的分支条件。

## 7. 双环境发布步骤

每次完成修复、优化或变更（用户未指定例外）都要：先测试分支，再正式分支，同一任务完成。

1. 记录工作树与当前线上构建。切 `v2-development`，保存无关未跟踪文件。
2. 如改数据库或做高风险服务器维护，先强制本地备份，并确认两环境都 complete。仅前端/文档修改不需要数据库迁移。
3. 新增迁移，测试环境先 dry run、执行、核验；再以同一迁移独立更新正式环境。不要把测试业务数据带入正式。
4. `package.json` patch +1；`src/config/version.ts` 顶部新增同号中文更新。这里会显示给用户，只写业务更新摘要。
5. 提交测试分支，使用对应配置执行 `pnpm run release:check`。当前本机安全包装入口如下，它内部读取仓库外凭据并执行同一门禁：

```powershell
node D:\codex_develop\storehub-tencent-production\run-release-check.mjs development
```

6. 通过后 push 测试分支；构建测试包并部署测试 Pages，检查真实 `/version.json`。
7. 将已验证测试提交合并到 `manage-system`，对正式 merge commit 再跑：

```powershell
node D:\codex_develop\storehub-tencent-production\run-release-check.mjs production
```

8. 正式门禁通过后才 push、构建并部署正式站；两个远端分支 SHA 与两个线上 buildId 都要核对。Git push 成功不代表 Pages 已更新。
9. 视改动验证真实登录、登录后读取、关键写入、图片、员工/店长/管理员权限及 Android。不要仅看首页或 manifest 就宣称业务全部正常。

门禁包含：版本、分支/环境/Key 指纹、迁移安全、微信兼容、远端迁移一致性、Schema/RLS、安全扫描、类型、Lint、Vitest、构建。禁止跳过远端迁移核对或改脚本让失败变成功。

本机辅助构建器：`D:\codex_develop\storehub-tencent-production\build-reference-release66.mjs development|production`。它从当前 checkout 构建，因此必须先切到正确分支；历史文件名 66 不代表只能构建 3.0.66。产物 `reference66-release-<environment>` 中含 Worker 和版本清单。Wrangler 的实际路径由当前 pnpm/cache 安装确定，不把曾用的随机 dlx 缓存子目录写死为永久入口。

```powershell
# 已安全登录 Wrangler，且产物经过对应环境门禁后使用；SHA 填本次真实提交。
pnpm exec wrangler pages deploy <构建目录> --project-name oms-store-development --branch v2-development --commit-hash <测试提交SHA>
pnpm exec wrangler pages deploy <构建目录> --project-name oms-store-management --branch manage-system --commit-hash <正式合并SHA>
```

若仓库没有 wrangler 依赖，使用已有仓库外安装或明确版本的 `pnpm dlx`，不要为了部署随意修改业务依赖。下载/认证受网络影响时查本机代理；最近包装脚本使用 `http://127.0.0.1:7897`，代理并非系统必须依赖。

## 8. 数据库、函数与回滚

迁移编号、文件、静态对象/RPC 索引见 [CODE_MAP.md](handover/CODE_MAP.md)。`config/environment-policy.json` 的旧项目 ref 与 Key 指纹用于环境隔离，不是让部署返回托管 Supabase 的指令。

当前门禁通过 `STOREHUB_MIGRATION_CHECK_CONFIG` 读取仓库外 `migration-check-development.json` / `migration-check-production.json`，SSH 进入真实腾讯云容器，只读比对 `supabase_migrations.schema_migrations`。受限托管项目 CLI 链接状态不能替代当前数据库事实。

数据库修改注意：新增编号；明确事务边界、RLS、门店权限、`search_path`、角色授权、审计/通知同步；必要时更新 `src/types/database.ts`。PostgreSQL 函数套层包装较多，修改前读最新实际函数定义，不能只基于最早迁移重建。给新可写表保留版本兼容检查触发器。

函数代码变更必须更新两环境云端 `/opt/storehub-<env>/functions` 对应文件并使 edge-runtime 生效；不能只推前端，也不能照旧文档执行托管项目 `functions deploy` 后就声称腾讯云已更新。保留现有 runtime 的内部路由、函数鉴权与 Secrets。

回滚优先回滚前端产物，不默认回滚数据库。`system_release_control` 使用精确允许版本列表；如 enforcement 已 block，先允许旧/新版本过渡，发布/回滚验证后再收紧，不用“版本越大越合法”的比较。详见 [RELEASE_UPDATE_AND_ROLLBACK.md](RELEASE_UPDATE_AND_ROLLBACK.md)。旧文档的 2.4.x 只是示例。

## 9. 备份与恢复

现在业务数据一直在腾讯云；本地旧开发/正式数据库是迁移时代的存档，不是实时镜像。

- Windows 计划任务 `StoreHub-LocalBackup`：当前用户登录后隐藏运行 `D:\StoreHubBackups\bin\run-local-backup.ps1`，不是开机未登录就运行。
- 同次开机成功后跳过；失败每 5 分钟重试，最多 12 次。电脑一直开机不会自动每日另做一次；需要新快照可手动 Force。
- 每次数据库完整逻辑转储；照片按 SHA-256 增量、去重、校验复用，断线不丢已成功下载内容。
- 每环境保留首份基线和最近 30 份成功快照；本地预留 10GiB。只在完整校验后轮换，不能只复制 snapshots 忘记 blobs。
- 两个云端 backup service 与 timer 已退休并 mask，不重新启用，不运行 `ops/backup-cloud.sh`。证书续期 timer 仍需要运行，它不是数据库备份。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\StoreHubBackups\bin\run-local-backup.ps1 -Force
# 等执行结束，再检查两环境；不能只看到一个旧 complete 就认为刚执行成功。
Get-Content D:\StoreHubBackups\backup-status.json
Get-ScheduledTaskInfo -TaskName StoreHub-LocalBackup
```

快照包含 `database.dump`、`globals.sql`、`database-keys.tar.gz`、`config.tar.gz`、`storage-manifest.json`、`backup.json`；图片在环境目录 `blobs`。`latest.json` 指向最新已完成快照。保留保护 ACL 与备份专用 SSH 私钥。

2026-11-25 实际自动开机备份完成：正式版 13:35:59（5,986 个文件），测试版 13:36:54（313 个文件）；正式新下载约 2.77MB、测试为 0，证明增量复用已实际生效。这是当时自托管存储卷的文件清单，不等于已逐一对账原 Supabase 云项目全部历史对象。

2026-11-24 已做正式数据库完整恢复到独立临时实例，以及图片内容/扩展属性抽样恢复。验证隔离外网、关闭 cron，不覆盖线上卷。备份为数据库与图片先后采集，并非暂停业务后的单一原子时间点；严格整库时间点一致恢复仍需另外协调冻结/PITR，不能过度承诺。

恢复前用 `local-backup.py --config ... --verify` 全量校验；Linux 上用 `ops/restore-local-storage.py` 向新的空目录重建路径、权限、大小写和 xattrs。数据库使用匹配的 Supabase PostgreSQL 版本、全局角色与 pgSodium 根密钥恢复。普通 Windows 文件夹中的哈希 blobs 不可直接塞进现有 Storage 内部卷。

## 10. 故障排查顺序与已踩过的坑

| 症状 | 优先检查 | 不要做 |
|---|---|---|
| 所有人无法登录 | 云主机磁盘、Docker 状态、Auth / Functions / DB 日志、源站 TLS、Worker 绑定 | 先重置员工密码、删账号、清数据库 |
| 502/网页 HTML 出现在页面 | Worker 到源站、TLS、Kong/REST、过长 in 查询、分页；`releaseAwareFetch` 错误净化 | 把整页 HTML 作为业务错误展示 |
| 有内容却没有图片 | 图片对象是否真实存在、Storage 记录/路径版本/xattrs、签名与源站、imgproxy、会话缓存 | 让图片失败挡住整个业务页 |
| 考勤补卡没有更新 | 企业映射、员工日期有效关联、权限、同步 jobs/failures/覆盖进度、实际响应 | 生成工资时强制再查钉钉；无凭据就要用户重填 |
| 工资不正确 | 所选月份、已保存考勤、历史规则、生效日期、关店、收入来源、管理员覆盖、工资单快照 | 直接改员工历史数据来迎合公式 |
| 模板/周期任务空列表 | 环境、权限、分页、模板状态与适用门店、接口错误，勿混淆 V1/V2 | 默认为没有数据或覆盖现有模板 |
| 操作日志加载更多跳动 | 稳定排序/分页游标、去重、已有列表追加与滚动保持 | 每次全量重载并插入顶部 |
| 待办审批后又出现 | 多个异步请求结果顺序、取消/代次检查、服务器原子批量处理 | 仅前端移除后让旧请求重新覆盖 |
| SSH 在握手前关闭 | 当前网络/代理、22端口、sshd/防火墙/限流，区分 HTTP 服务状态 | 将其当密码错误或跳过发布门禁 |

2026-11-24 停机主因是同机无界照片备份累积约 49GiB，加上 PostgreSQL 日志约 2.7GB 导致磁盘耗尽；已清过期照片备份副本、保留业务库与在线图片，并给 16 个服务配置 json-file 10MB×3 日志上限。随后改成本地备份，云端原历史备份未全部删除。禁止 `docker system prune --volumes`、删除在线 Docker 卷或一键覆盖 Compose。

旧 Supabase 的数据库和 Storage 是不同服务/下载通道；能导出数据并不表示受配额/访问限制的对象文件能下载。迁移初期只保留了部分原图，2026-11-08 又恢复了一批正式历史图片。最新云端文件数与旧报告不能混为同一口径；需要“全部原云照片恢复”时重新对照原始对象清单与逐项失败报告，不承诺未验证的对象。

## 11. 明确待核实事项

- 原 Supabase 全部历史图片是否完全恢复：只凭当前备份成功不能证明；需结合原始 inventory、缺失 manifest 与对象下载验证。
- 腾讯云续费/到期日：旧文档日期已过去，当前需控制台确认；不擅自开自动续费或新增付费资源。
- `sslip.io` 为免费第三方 DNS 过渡方案，非用户自有域名；改域名涉及 Worker allowlist、TLS、Auth、Android 下载白名单等，不能只改 Nginx。
- 测试环境的第三方凭据、cron、AI 开关需要分别确认；不能假设与正式相同，也不能复制正式凭据自动启用。
- 新年度法定节假日需要权威日历数据；假期连休日/调休不是全部法定日，不能无限复用 2026 年表。
- 开机备份不是离线时实时同步，不是全年全天候备份；整台电脑丢失仍有风险，需要用户有新要求时再安排额外离线/异地副本。
- 本次整理时 SSH 出现握手前连接关闭；配置/镜像拓扑改用今日成功备份中的 Compose 核实，未把它描述为新的实时 SSH 验证。发布是否完成以本次门禁、两个分支 push 及线上清单为准。

## 12. 可直接交给下一个 agent 的起始提示

> 你将接手 StoreHub，工作区 D:\codex_develop\manage_system。先读 AGENTS.md、docs/AGENT_HANDOVER.md 及 docs/handover 下的索引，检查 git status、当前分支、两个线上 version.json。当前正式和测试业务后端在腾讯云 43.163.113.19 的 /opt/storehub-production 与 /opt/storehub-development；旧本地数据库是存档。凭据从交接文档索引指向的仓库外私有配置安全读取，不输出/提交密钥，不重新问已保存配置。保留工作树无关文件。默认每次修改同时发布测试与正式，patch 版本递增、两次 release:check、分别验证部署。数据库/高风险维护前强制本地备份，两环境成功后再操作；云端备份 timer 已退休。Android 共用网页，图片正文先显示。员工端只展示必要结果，不暴露开发讨论或管理员计算细节；验收不消耗付费 AI token。先核对事实再继续用户的新任务，未完成的验证应明确说明，不按历史计划盲目恢复或重新迁移。
