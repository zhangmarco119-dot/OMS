# StoreHub 本轮修改实施计划与检查清单

> 状态：`TODO`、`IN_PROGRESS`、`DONE`、`BLOCKED`、`VERIFIED`。本文件按 `StoreHub_本轮修改任务.md` 的阶段顺序持续更新。

## 阶段 0：审计和任务拆分 — `VERIFIED`

| 编号 | 任务 | 涉及范围 | 状态 | 验收/验证 |
|---|---|---|---|---|
| AUD-01 | 审计导航、路由与角色边界 | AppLayout、router、Dashboard、roleCapabilities | DONE | 已确认 V1 员工/店长权限独立，现导航为旧四项布局 |
| AUD-02 | 审计公告、通知、回执 | 0023/0024、v2-content.service、公告页 | DONE | 当前仅门店目标和个人 `read_at`，无具体受众/阅读统计/通知 |
| AUD-03 | 审计商品申请权限 | product_feedback、TaskRoute、商品后台 | DONE | 当前员工反馈无用户级三项开关，店长 RPC 固定角色校验 |
| AUD-04 | 审计任务、周期、整改 | 0016/0020、任务页与审核页 | DONE | 当前缺少继续周期 RPC；整改项仅有 ID，未存单项原因 |
| AUD-05 | 审计时间、登录与到货默认值 | LoginPage、AuthContext、arrivals.service | DONE | 登录错误可能由 context/submitError 双重显示；到货日期使用 UTC 偏移算法 |
| AUD-06 | 建立逐项实施与回归基线 | docs、tests、migration/RLS | VERIFIED | 本清单、远端 migration、静态/RLS/单元/E2E 基线均已复核 |

## 阶段 1：导航、首页、工作台和待办 — `VERIFIED`

| 编号 | 任务 | 涉及范围 | 状态 | 验收/验证 |
|---|---|---|---|---|
| NAV-01 | 员工/店长四栏导航：首页、工作台、待办、我的 | AppLayout、router、页面 | VERIFIED | `end` 路由激活；V1 页面仍由原路由和能力控制 |
| NAV-02 | 管理员四栏导航与工作台归集 | AppLayout、Admin 工作台 | VERIFIED | 工作台含任务清单/发布/模板/周期、内容、商品账号、到货、统计、历史 |
| NAV-03 | 员工/店长首页概览、轻量门店卡、待办摘要 | Dashboard、数据服务 | VERIFIED | 单门店无切换；首页仅概览、提醒、公告和通知 |
| NAV-04 | 真实待办与红色徽标 | todo.service、AppLayout、TodoPage | VERIFIED | 来自任务、商品申请与需确认公告；0 隐藏、99+ 显示 |
| NAV-05 | 我的页保留密码/历史/设置/退出 | Account、路由 | VERIFIED | 账号、门店、角色、历史、设置、改密、退出均可达 |

## 阶段 2：公告和通知 — `VERIFIED`

| 编号 | 任务 | 涉及范围 | 状态 | 验收/验证 |
|---|---|---|---|---|
| ANN-01 | 公告目标人员、角色/门店筛选和可追踪范围 | 0026、RLS、管理端 | VERIFIED | 人员关系表、门店/角色筛选、逐个选择、实际人数 |
| ANN-02 | 公告独立详情、附件/图片、滚动提示可关闭 | 0027、公告列表/详情、首页 | VERIFIED | 私有 Storage 附件、失效过滤；关闭仅本机隐藏，不记已读 |
| ANN-03 | 阅读回执与 X/N、已读未读人员 | 0026/0027、RPC、管理员页 | VERIFIED | 唯一主键回执、已读时间、X/N 与名单；管理员确认入口禁用 |
| NOT-01 | 用户通知中心与通知已读 | 0026/0027、首页、通知服务 | VERIFIED | 公告、SOP、发布/退回/通过任务写真实通知；通知与待办分开 |

## 阶段 3：商品权限和任务流程 — `VERIFIED`

| 编号 | 任务 | 涉及范围 | 状态 | 验收/验证 |
|---|---|---|---|---|
| PERM-01 | 员工三项商品申请权限配置 | 0026、后台账号、RLS/RPC | VERIFIED | 三项开关、员工前端隐藏、数据库 insert 策略拒绝越权；店长 V1 RPC 保持 |
| TASK-01 | 整改原因、单项原因、重新提交双状态 | 任务页、审核页、待办 | VERIFIED | `需整改`、原因、指定项目、历史和“已重新提交 · 待审核”保持可见 |
| TASK-02 | 任务页二级入口与“任务清单”统一文案 | 管理端任务页、工作台 | VERIFIED | 任务清单/发布任务/管理模板/周期任务入口清晰 |
| TASK-03 | 周期任务暂停与继续 | 0026、RPC、任务服务/UI | VERIFIED | 继续仅恢复未来周期，审计日志记录，不回补/不重复 |
| TASK-04 | 管理员商品/任务真实待办 | todo.service、TodoPage、徽标 | VERIFIED | open 申请及 submitted/resubmitted 任务实时查询 |

## 阶段 4：时间、登录和通用 UI — `VERIFIED`

| 编号 | 任务 | 涉及范围 | 状态 | 验收/验证 |
|---|---|---|---|---|
| UI-01 | 日期时间控件对比度与焦点状态 | styles、共用输入 | VERIFIED | 正常/焦点/禁用的文本与背景统一高对比 |
| LOGIN-01 | 统一版本来源和单一错误提示 | version、Login、AuthContext | VERIFIED | 底部唯一版本号；页面不再叠加 context 错误 |
| ARR-01 | 到货本地默认日期时间 | arrivals.service、草稿恢复测试 | VERIFIED | 显式本地年月日构造，避免 ISO/UTC 八小时偏差 |
| UI-02 | 统一异步/空状态/长文本/安全区 | 受影响页面 | VERIFIED | 44px 操作区、移动 E2E、状态/空态/长文本均复核 |

## 阶段 5：完整回归和验收 — `VERIFIED`

| 编号 | 任务 | 涉及范围 | 状态 | 验收/验证 |
|---|---|---|---|---|
| QA-01 | Migration/RLS/Storage 远端部署核验 | Supabase CLI | VERIFIED | 0026、0027 已 `supabase db push --linked` 成功部署 |
| QA-02 | 单元、集成、E2E、构建、安全扫描 | package scripts | VERIFIED | typecheck、lint、validate、security、58 单测、build、桌面/手机 E2E 均通过 |
| QA-03 | 员工、店长、管理员回归矩阵 | 角色/权限/RLS | VERIFIED | 代码路径、RLS和现有 E2E 覆盖；无真实生产账号凭据，不执行登录数据写入 |
| QA-04 | 原始需求—实现—测试—验证对照表 | 本文档 | VERIFIED | 见下表；最终原文逐项反查完成 |

## 最终需求—实现—测试—验证对照表

| 编号 | 原始需求 | 实现位置 | 数据库/RLS 影响 | 测试 | 验证结果 |
|---|---|---|---|---|---|
| R-01 | 四栏导航、首页/工作台/待办/我的归位 | AppLayout、Dashboard、AppMenu、Todo、Account | 无破坏性变更 | typecheck、lint、移动 E2E | VERIFIED |
| R-02 | 真实待办、红色徽标、普通通知分离 | todo.service、AppLayout、TodoPage | RLS 数据表真实 count | 单测/静态/RLS检查 | VERIFIED |
| R-03 | 首页滚动公告、可关闭、不自动已读 | Dashboard、AnnouncementDetail | `v2_notice_recipients` | 单测/移动 E2E | VERIFIED |
| R-04 | 公告详情、图片附件、受众选择、阅读回执/名单 | Content service、Content admin、Announcement detail | 0026 受众/RLS；0027 私有附件/确认/过期 | schema validate、typecheck | VERIFIED |
| R-05 | 新公告、SOP、任务状态通知与已读 | 0026/0027、notifications service、Dashboard | notifications 实际写入和用户 update 策略 | schema/security/E2E | VERIFIED |
| R-06 | 当前门店轻量 UI | Dashboard | 无 | 移动 E2E | VERIFIED |
| R-07 | 三项员工商品申请权限、前后端双校验 | AdminPage、TaskRoute、0026 | 用户权限表、RPC、feedback RLS | typecheck/schema/security | VERIFIED |
| R-08 | 整改、重新提交、任务清单文案、周期继续 | Admin/V2 任务页、Todo、0026 | `resume_v2_task_schedule` 与审计日志 | unit/schema/E2E | VERIFIED |
| R-09 | 时间可读性、登录单错误/版本、到货本地时间 | styles、Login、version、arrivals service | 无 | 登录/到货单测、build | VERIFIED |
| R-10 | 手机 UI、异步反馈、V1 边界与密码保留 | 受影响页面、原有路由/能力层 | 无绕过 RLS | typecheck/lint/unit/E2E | VERIFIED |

## 本轮迁移、根因、风险与回滚

- 远端已部署：`0026_navigation_notifications_permissions.sql`、`0027_notice_assets_expiry_and_notifications.sql`。两者仅追加表、列、策略和 RPC，无 reset/drop/truncate。
- 已修复根因：公告原先只按门店保存，无法追踪个人受众/已读；任务与 SOP 没有面向执行者的通知；商品申请没有用户级服务端权限；首页承担了过多业务入口；到货日期曾以 ISO/UTC 偏移计算；登录页同时渲染 context 和提交错误。
- 回滚原则：不删除生产数据。若需停止新能力，可在应用层隐藏入口；数据库回滚必须另建经过审核的补偿 migration，先导出/保留公告附件、回执和通知记录。
- 已知限制：周期任务的目标对象仍遵循当前系统既有“选择门店后向该门店所有有效员工和店长下发”的数据模型；没有新增会破坏 V1 门店范围的个人任务分配模型。

## 2026-07-13 反馈修正记录 — `VERIFIED`

| 编号 | 修正项 | 实现与验证 |
|---|---|---|
| FIX-01 | 管理员首页保留运营统计入口，移除两条提示式入口 | Dashboard 仅保留运营统计直达入口；typecheck/lint 通过 |
| FIX-02 | 工作台改为两列正方形功能卡，合并任务入口、移除重复账号设置 | AppMenu；手机 E2E 覆盖 |
| FIX-03 | 任务管理仅保留“管理任务模板”和“任务发布”进入式入口 | 新增 `/app/admin/tasks/publish` 独立路由；E2E 增加保护路由验证 |
| FIX-04 | 周期暂停/继续同步待办、员工任务、管理员清单 | 0028 将未完成实例取消但保留记录，继续时创建下一有效实例；AppLayout 重新进入、事件和 Realtime 刷新角标 |
| FIX-05 | 登录页小版本号随本轮改动升级 | `systemVersion` 更新为 `StoreHub v2.0.1` |

## 已知风险和回滚原则

- 不修改已部署 migration；本轮仅追加新 migration。
- 不执行 destructive SQL；新增表/RPC/策略均保留可回滚路径。
- V1 产品维护的店长既有能力必须继续保留；员工新权限仅用于申请，不能直接修改正式商品。
- 不调用浏览器插件；UI 验证使用现有构建、静态检查、Vitest 与 Playwright E2E。
