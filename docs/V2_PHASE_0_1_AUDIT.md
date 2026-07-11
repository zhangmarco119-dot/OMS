# StoreHub V2 阶段 0/1 审计与设计草案

> 本文保留阶段 0/1 当时的审计和设计记录。阶段 2 已实施，当前状态以 `docs/V2_PHASE_2_DATABASE.md` 为准。

审计基线：`42d139e`（V1 `manage-system` 最新提交）

实施分支：`v2-development`
审计日期：2026-07-12

## 1. 本轮边界

本轮只完成：

- 阶段 0：V1 代码、数据库、RLS、Storage、测试与构建审计；
- 阶段 1：工作台入口、动态导航、V1/V2 角色边界和功能开关；
- 阶段 2 的数据库、RLS、Storage 与 UI 设计草案。

本轮不创建到货 migration，不创建 Storage bucket，不实现到货草稿、图片上传、提交、通知、汇总或 Excel 导出。

## 2. V1 代码和功能审计

### 2.1 现有技术和模块

- React 18、TypeScript strict、Vite、Tailwind CSS、React Router；
- Supabase Auth、PostgreSQL、RLS 与两个 Edge Functions；
- React Hook Form、Zod、xlsx、Vitest、Testing Library、Playwright；
- V1 路由：登录、角色首页、点货、订货、历史、账号、管理员后台；
- V1 数据：门店、账号、账号门店权限、管理员门店权限、商品、任务、任务明细、商品反馈、管理员已读、审计日志；
- V1 migrations 保持原样，本轮没有修改任何已执行 migration。

### 2.2 员工、店长和管理员差异

| V1 能力 | 员工 `staff` | 店长 `manager` | 管理员 `admin` |
|---|---|---|---|
| 首页 | 点货、订货 | 点货、订货 | 独立消息中心 |
| 点货/订货执行 | 可执行 | 可执行 | 不可执行，显示管理员权限说明 |
| 历史记录 | 仅本人提交 | 当前门店全部提交 | RLS 授权门店全部提交 |
| 信息有误 | 提交商品反馈 | 直接更正商品并通知管理员 | 在后台处理反馈 |
| 不再使用 | 提交反馈 | 发起删除申请，等待管理员确认 | 确认删除或忽略 |
| 新增商品 | 仅当前任务临时商品 | 写入本店商品库并加入当前任务 | 后台管理商品 |
| 商品与账号后台 | 无权访问 | 无权访问 | 独立后台 |
| 底部导航 | 首页、点货、订货、记录、账号 | 首页、点货、订货、记录、账号 | 消息、记录、后台、账号 |

上述差异继续由 V1 页面、服务和 RLS 执行。阶段 1 仅把判断集中为显式能力函数，判断结果未改变。

### 2.3 V1 数据隔离与 RLS

- 业务表使用 `store_id`；`task_items` 通过触发器校验父任务门店一致性；
- 员工修改自己的未提交任务，店长可管理本店任务，管理员按 `admin_store_access` 授权门店访问；
- 员工历史查询附加 `created_by = profile.id`；店长历史查询附加 `store_id = profile.store_id`；
- 商品更正、删除申请、新增正式商品和管理员处理通过受控数据库函数完成；
- 已提交任务保留商品快照，商品删除不会删除历史明细；
- 静态 schema 校验覆盖 10 张表、17 条策略和关键安全函数；
- 前端仅读取 `VITE_SUPABASE_URL` 与 anon/publishable key，Service Role Key 只允许存在于 Edge Function 环境。

### 2.4 Storage 审计

V1 当前没有业务图片 bucket，也没有 `storage.objects` 策略。阶段 1 不提前创建 V2 bucket，避免出现未被业务表状态约束的半成品上传权限。阶段 2 必须把私有 bucket、对象路径和数据库记录策略作为同一次 migration 交付并验证。

### 2.5 修改前基线

- typecheck：通过；
- unit：8 个测试文件、20 个测试通过；
- build：通过；
- lint：正式源码无报错，但 ESLint 扫描了 Git 已忽略的 `.tmp/remote-oms` 临时副本并失败。本轮将 `.tmp` 等工具目录加入 ESLint ignore，不修改临时副本。

## 3. 阶段 1 实施设计

### 3.1 明确的角色边界

`src/features/access/roleCapabilities.ts` 分离三项能力：

- `getV1HistoryScope`：保留员工本人、店长本店、管理员授权门店差异；
- `canManageV1ProductsFromTask`：仅店长拥有 V1 任务内商品维护能力；
- `canOperateV2Modules`：仅员工和店长共享 V2 门店执行模块。

V2 能力函数不能替换 V1 能力函数，也不能用于放宽 V1 RLS。

### 3.2 功能开关

环境变量：

```text
VITE_ENABLE_V2_ARRIVAL_ENTRY=true
```

- 默认开启阶段 1 到货入口；
- 设置为 `false` 时同时隐藏门店首页卡片和底部导航入口；
- 直接访问路由时显示明确的“入口未启用”状态；
- 关闭开关不影响任何 V1 路由或数据。

### 3.3 门店工作台

- 点货和订货卡片路径、文案和目标页面不变；
- 员工和店长均显示独立的“到货上报”卡片和底部“到货”导航；
- `/app/arrivals` 复用同一执行入口组件；
- 阶段 1 页面只说明权限边界和当前门店，不提供假上传、假提交或空按钮；
- 管理员访问门店执行路由时显示权限说明，不获得门店执行权限。

### 3.4 管理员工作台

- 保留原消息中心、已读处理、历史和后台入口；
- 新增“到货中心”骨架卡片；
- 数据未接入时使用“尚未接入数据”状态，不显示伪造的 0 或模拟统计；
- 管理员到货列表、消息、详情和汇总留到阶段 4。

## 4. 阶段 2 数据库设计草案

以下内容仅为下一阶段设计，本轮不执行。

### 4.1 表

#### `arrival_reports`

- 主键 `id uuid`；
- 唯一业务编号 `report_no text`；
- `store_id`、`reported_by`；
- 门店和提交人名称快照；
- 实际到货日期、时间、配送方、单号、自动描述、备注；
- 状态：`draft | submitted | viewed | voided`；
- `submitted_at`、`viewed_at/by`、`voided_at/by/reason`；
- `version integer default 1` 用于乐观并发；
- 创建和更新时间。

#### `arrival_report_items`

- 主键、`report_id`；
- 可空 `product_id`；
- 商品名称快照、数量、单位、备注；
- `is_unmatched_product`、`sort_order`；
- 创建和更新时间。

#### `arrival_report_images`

- 主键、`report_id`、`store_id`；
- `image_type: waybill | goods`；
- bucket、对象路径、原始文件名、MIME、字节数、宽高；
- 上传人和创建时间。

#### `notifications`

- 若实施前发现已有可复用通知表则扩展，不重复建同义表；
- 支持用户、角色和门店收件范围；
- 类型、标题、正文、实体类型/ID、已读状态和时间。

### 4.2 约束和索引

- `arrival_reports(report_no)` 唯一索引；
- `arrival_reports(store_id, arrival_date desc)`；
- `arrival_reports(store_id, status, submitted_at desc)`；
- `arrival_reports(reported_by, status, updated_at desc)`；
- draft 的幂等键使用唯一约束或提交 RPC 内部锁定，禁止双击生成重复正式记录；
- `arrival_report_items(report_id, sort_order)`；
- `arrival_report_items(product_id)` 条件索引；
- `arrival_report_images(report_id, image_type, created_at)`；
- `arrival_report_images(object_path)` 唯一索引；
- `notifications(recipient_user_id, is_read, created_at desc)`；
- `notifications(recipient_role, store_id, is_read, created_at desc)`；
- 数量必须大于 0，单位和名称 trim 后非空；
- 作废必须有原因，已查看必须有查看人和时间；
- 图片 `store_id` 必须与父到货单一致，由触发器校验。

### 4.3 View/RPC

- `arrival_daily_detail_view`：按到货单展开商品明细，排除 `voided`；
- `arrival_daily_product_summary_view`：按日期、门店、商品名称和单位聚合，单位不同不合并；
- `submit_arrival_report(report_id, expected_version, idempotency_key)`：服务端校验状态、图片、明细、摘要和角色，原子提交并创建通知；
- `mark_arrival_viewed(report_id)`：仅管理员，记录查看人和时间；
- `void_arrival_report(report_id, reason)`：仅管理员，保留审计记录；
- 聚合在 SQL View/RPC 完成，前端不拉取全量数据计算。

## 5. 阶段 2 RLS 与 Storage Policy 草案

### 5.1 数据表 RLS

员工和店长：

- 可创建 `store_id = current_user_store_id()` 且 `reported_by = auth.uid()` 的草稿；
- 只可修改和删除自己创建的 `draft`；
- 不可通过更新 `store_id` 或 `reported_by` 改变归属；
- 可查看本门店允许查看的 V2 记录，具体历史范围在阶段 2 集成测试前再次确认；
- 不可直接把状态改为 submitted/viewed/voided，正式状态转换只走 RPC。

管理员：

- 只读 `has_store_access(store_id)` 为真的到货记录和图片；
- 可通过 RPC 标记查看和作废；
- 不直接修改门店提交的商品明细或图片。

所有子表策略必须通过父 `arrival_reports` 校验门店、创建人和状态，不能只相信客户端传入的 `store_id`。

### 5.2 私有 Storage

Bucket：`arrival-report-images`，`public = false`。

对象路径：

```text
{store_id}/{report_id}/waybill/{uuid}.{ext}
{store_id}/{report_id}/goods/{uuid}.{ext}
```

策略：

- 员工/店长仅能向自己的本门店 draft 路径上传；
- 上传对象的 `store_id/report_id` 必须能关联到数据库草稿，不能只检查路径首段；
- 员工/店长仅能删除自己未提交草稿的图片；
- 提交后普通用户不可覆盖或删除；
- 管理员仅能读取授权门店对象；
- 禁止公开 URL，读取使用短期签名 URL；
- MIME 仅允许 JPEG/PNG/WEBP，大小上限由前端压缩和服务端/Storage 限制共同执行；
- 数据库图片记录和 Storage 对象的创建/删除要有失败补偿与孤儿对象清理方案。

## 6. 阶段 2/3 UI 组件草案

### 6.1 门店端

```text
ArrivalReportPage
├─ ArrivalHeader
├─ ArrivalMetaCard
├─ ArrivalImageSection (waybill)
├─ ArrivalImageSection (goods)
├─ ArrivalItemsEditor
│  └─ ArrivalItemCard[]
├─ ArrivalGeneratedSummary
├─ ArrivalValidationSummary
└─ ArrivalStickyActions
```

服务层计划：

```text
src/services/arrivals.service.ts
src/services/arrival-images.service.ts
```

页面不直接散落 Supabase 查询。草稿、上传和提交状态由服务层统一返回明确错误。

### 6.2 管理员端

```text
AdminArrivalDashboardCard
AdminArrivalMessages
AdminArrivalList
├─ ArrivalFilters
├─ ArrivalDesktopTable
└─ ArrivalMobileCards
AdminArrivalDetail
AdminArrivalDailySummary
```

阶段 4 才接入真实通知、详情、作废、汇总和 Excel。

## 7. 风险

- 真实 Supabase 项目可能存在未同步回仓库的手工 schema，需要阶段 2 开始前通过 CLI diff 再确认；
- 管理员授权门店与普通账号多门店切换是两种不同权限模型，新增 RLS 不能混用；
- 图片对象和数据库记录跨系统写入，不具备原生单事务，需要补偿与清理；
- V1 经理权限较员工更高，任何“员工和店长共享”判断只能用于 V2 新模块；
- 阶段 1 到货页有意不提供提交功能，必须等数据库/RLS/Storage 验证后再开放。

## 8. 回滚

### 8.1 立即关闭入口

将部署环境设置为：

```text
VITE_ENABLE_V2_ARRIVAL_ENTRY=false
```

可隐藏 V2 工作台卡片和导航，V1 路由不受影响。

### 8.2 代码回滚

回滚阶段 0/1 提交即可。由于本轮没有 migration、bucket 或业务数据写入，不需要数据库回滚或数据清理。

### 8.3 阶段 2 以后

新增 migration 必须另附逆向 SQL；优先停用入口和写入策略，再处理对象和表结构。不得修改或删除 V1 旧 migration。

## 9. 本地和手机验收

本地分别使用员工、店长、管理员账号：

1. 员工确认原点货、订货、本人历史不变，并能看到到货入口；
2. 店长确认商品更正、删除申请、正式新增商品和本店历史仍可用，并能看到同一个到货入口；
3. 管理员确认消息、记录、后台不变，只显示独立到货中心骨架；
4. 直接让管理员访问 `/app/arrivals`，确认不会获得门店执行权限；
5. 关闭功能开关，确认 V2 入口消失而 V1 导航和路由继续工作。

手机使用 390px 左右视口重复员工和店长工作台、底部导航、到货入口页与 V1 点货/订货返回流程，确认无横向滚动且底部安全区域可用。
