# StoreHub 全系统 UI/UX 专业化改造计划

## 1. 保护边界与基线

- 仅调整展示层、交互反馈和共享 UI 组件，不修改数据库、RLS、服务入参或业务流程。
- 保留员工、店长、管理员现有权限差异，以及所有既有路由和入口。
- 保留“我的”、修改密码、退出登录、门店切换、图片上传、任务审核、公告确认、商品申请、点货、订货、到货等能力。
- 基线（2026-07-13）：TypeScript、ESLint、28 个测试文件 / 80 项测试全部通过。
- 目标视口：320px 小屏、390px 手机、768px 平板、1280px 桌面；底部导航和操作栏适配安全区域。

## 2. 设计系统改造

| 范围 | 当前问题 | 改造目标 | 状态 |
|---|---|---|---|
| 颜色 | 页面散落十六进制色值，状态色使用不统一 | 建立 surface/text/border/brand/success/warning/danger/info/disabled/unread/todo 色阶 | VERIFIED |
| 字体 | 同级标题字号和字重不一致 | 统一页面、区块、卡片、正文、辅助、标签和数据层级 | VERIFIED |
| 间距 | 3/4/5 等间距混用，部分移动页面过松 | 统一 4/8/12/16/20/24/32px 体系 | VERIFIED |
| 圆角与阴影 | 大量卡片都使用明显阴影 | 统一 8/10/12px 圆角，默认细边框，仅浮层使用明显阴影 | VERIFIED |
| 图标与触控 | 图标按钮大小不一 | 统一 Lucide 图标和至少 44×44px 触控区 | VERIFIED |
| 状态与反馈 | 空态、加载、错误和提示各页面自绘 | 抽取 StatusBadge、EmptyState、LoadingState、ErrorState、Toast、Dialog | VERIFIED |
| 页面框架 | 标题、返回、内容间距和底部操作不统一 | 统一 PageShell、BottomNavigation、MobileActionBar | VERIFIED |
| 浮层与底栏 | 旧弹窗、抽屉与底部导航存在同层竞争和遮挡 | 统一 z-80 弹窗层、导航避让、安全区和可滚动高度；成功提示与粘性操作栏同步避让 | VERIFIED |

## 3. 全页面审计清单

| 页面 | 角色 | 当前问题 | 改造内容 | 复用组件 | 状态 | 验证结果 |
|---|---|---|---|---|---|---|
| 登录 `/login` | 全部 | 大面积实色背景、反馈层级偏重 | 轻量品牌背景、统一表单与错误提示、保留版本号 | FormField、FeedbackBanner | VERIFIED | 四视口截图、E2E 与单测通过 |
| 首页 `/app` | 员工/店长 | 信息卡片层级相近、通知与待办略拥挤 | 轻量门店头部、数据摘要、待办与通知分层 | MetricCard、SectionHeader、NotificationItem | VERIFIED | 共享组件、路由与权限回归通过 |
| 首页 `/app` | 管理员 | 概览卡片密度和状态表达不统一 | 紧凑运营指标、异常优先、统一跳转反馈 | MetricCard、SectionHeader | VERIFIED | 管理入口与统计服务回归通过 |
| 工作台 `/app/workbench` | 全部 | 深色方块面积过大、说明文字拥挤 | 轻量功能卡、统一图标容器与文字对齐 | FeatureCard | VERIFIED | 三列响应式卡片与权限过滤通过 |
| 待办 `/app/todos` | 全部 | 不同类型卡片视觉体系不一致 | 类型分组、截止/动作/整改原因与空态统一 | TodoItem、StatusBadge、EmptyState | VERIFIED | 分组、跳转及角标服务回归通过 |
| 我的 `/app/account` | 全部 | 卡片阴影偏重、菜单与表单样式不统一 | 轻量资料区、菜单列表、密码表单与反馈统一，管理员增加关于系统入口 | SectionCard、FormField、FeedbackBanner | VERIFIED | 改密、退出、历史保留；关于系统仅管理员可见 |
| 关于系统 `/app/account/about` | 管理员 | 缺少面向管理员的版本更新说明 | 展示当前版本、发布日期及每次更新的中文摘要 | PageShell、ReleaseCard、StatusBadge | VERIFIED | 当前版本从最新更新记录自动派生并受管理员路由保护 |
| 点货 `/app/inventory` | 员工/店长 | 超长单文件内各阶段样式不一致 | 统一步骤头、产品列表、汇总、确认和底部操作 | StatusBadge、EmptyState、MobileActionBar、Dialog | VERIFIED | V1 流程、计算与权限回归通过 |
| 订货 `/app/order` | 员工/店长 | 同点货，操作说明和状态密度不一致 | 沿用点货统一结构，保留角色权限和商品申请 | 同上 | VERIFIED | V1 流程、申请和权限回归通过 |
| 到货上报 `/app/arrivals` | 员工/店长 | 子卡片边框/提示/操作条风格分散 | 统一上传、产品卡片、校验弹窗和操作栏；确认窗口避让底部导航 | SectionCard、FeedbackBanner、Dialog、MobileActionBar | VERIFIED | 表单、时间、图片、角色与弹窗遮挡测试通过 |
| 到货历史 `/app/arrivals/history` | 员工/店长 | 列表、加载、空态均为页面自绘 | 统一列表卡片、刷新、状态和空态 | RecordCard、StatusBadge、LoadingState、EmptyState | VERIFIED | 服务、状态与空态回归通过 |
| 到货成功 `/app/arrivals/:id/success` | 员工/店长 | 成功页卡片偏厚重 | 轻量结果反馈与明确后续操作 | ResultState、ActionButton | VERIFIED | 保护路由与后续入口通过 |
| 任务中心 `/app/tasks` | 员工/店长 | 说明卡偏大、状态卡缺少统一元数据结构 | 统一任务列表、整改提示、截止时间和空态 | TaskCard、StatusBadge、EmptyState | VERIFIED | 列表、状态和整改信息回归通过 |
| 任务执行 `/app/tasks/:id` | 员工/店长 | 多种字段、图片与底部操作样式不统一 | 统一任务信息、项目字段、图片预览和提交反馈 | FormField、ImageGrid、StatusBadge、MobileActionBar、Dialog | VERIFIED | 必填、上传、预览和提交测试通过 |
| 公告中心 `/app/notices` | 员工/店长 | 列表层级和未读标识偏弱 | 统一公告列表、置顶/未读、时间和点击反馈 | NoticeItem、StatusBadge、EmptyState | VERIFIED | 未读、置顶、跳转与空态通过 |
| 公告详情 `/app/notices/:id` | 员工/店长 | 正文、元数据和确认操作层级不统一 | 长文排版、附件、确认操作和安全区统一 | DetailMeta、MobileActionBar、FeedbackBanner | VERIFIED | 内容、附件和已读动作回归通过 |
| SOP 手册 `/app/sops` | 员工/店长 | 展开式长正文挤在列表卡片内 | 图片优先展示成品与关键步骤，正文和 PDF 分层，全屏查看图片 | FilterTabs、ImageGrid、EmptyState、AttachmentLink | VERIFIED | 多图展示、正文和附件状态通过 |
| 点货订货历史 `/app/history` | 全部 | 筛选、明细、申请处理和加载状态复杂 | 统一分段控件、记录卡、详情和申请操作 | SegmentedControl、RecordCard、Dialog、LoadingState | VERIFIED | 筛选、明细和商品反馈服务通过 |
| 运营历史 `/app/operations-history` | 全部 | 入口卡片语义和数据层级较弱 | 统一历史模块入口与数字摘要 | FeatureCard、MetricCard | VERIFIED | 角色入口和摘要查询通过 |
| 管理后台 `/app/admin` | 管理员 | 商品/账号两大面板样式密集且重复 | 统一工具栏、列表、导入导出和编辑反馈；普通账号隐藏内部认证邮箱，保存修改使用成功弹窗 | SectionHeader、RecordCard、Dialog、FormField | VERIFIED | 商品、账号、邮箱边界与导入导出测试通过 |
| 管理员到货中心 `/app/admin/arrivals` | 管理员 | 筛选与列表卡片信息重复 | 统一筛选栏、状态、时间和操作入口 | FilterTabs、RecordCard、StatusBadge | VERIFIED | 筛选、分页、消息和详情入口通过 |
| 到货汇总 `/app/admin/arrivals/summary` | 管理员 | 日期筛选和汇总表视觉层级不足 | 统一日期筛选、指标与可滚动表格 | FormField、MetricCard、DataTable | VERIFIED | 单日/区间、表格和导出测试通过 |
| 到货详情 `/app/admin/arrivals/:id` | 管理员 | 图片、明细、审计和危险操作分散 | 统一详情元数据、图片区、审计时间线和作废弹窗 | DetailMeta、ImageGrid、Timeline、ConfirmDialog | VERIFIED | 图片、日志、导出和作废确认通过 |
| 任务管理 `/app/admin/tasks` | 管理员 | 周期任务与任务清单缺少分区层级 | 统一入口、计划卡、任务卡和状态 | SectionHeader、TaskCard、StatusBadge | VERIFIED | 周期、清单、暂停和撤回入口通过 |
| 任务发布 `/app/admin/tasks/publish` | 管理员 | 大量单选/多选控件样式分散 | 统一表单、周期规则、门店选择和提交反馈 | FormField、ChoiceCard、FeedbackBanner | VERIFIED | 单次/周期规则与发布服务通过 |
| 任务审核 `/app/admin/tasks/:id` | 管理员 | 审核项目、图片和操作区层级不清 | 统一任务元数据、整改选择和审核操作栏 | StatusBadge、ImageGrid、MobileActionBar、ConfirmDialog | VERIFIED | 参考图、提交图、通过/退回/撤回通过 |
| 任务模板 `/app/admin/task-templates` | 管理员 | 编辑器信息密集、按钮和上传状态不统一 | 统一模板列表/归档、分组项目、图片上传和高层级安全区操作栏 | SegmentedControl、FormField、ImageGrid、MobileActionBar | VERIFIED | 草稿、归档、删除、多参考图和底栏遮挡测试通过 |
| 公告与 SOP 管理 `/app/admin/content` | 管理员 | 两类内容表单与列表混排 | 公告与 SOP 使用独立全屏滚动容器、高层级安全区操作栏；SOP 采用食品制作图片优先编辑器 | FormField、ImageGrid、MobileActionBar、ConfirmDialog | VERIFIED | 保存、发布、多图上传、删除和底栏遮挡测试通过 |
| 运营统计 `/app/admin/analytics` | 管理员 | 指标卡与趋势图颜色较多、空态不统一 | 收敛色彩、统一指标卡、日期筛选和图表说明 | MetricCard、FormField、EmptyState | VERIFIED | 日期范围、指标跳转和统计服务通过 |
| 路由错误页 | 全部 | 与业务页面视觉断层 | 统一错误状态、重试和返回动作 | ErrorState | VERIFIED | 错误反馈与操作入口通过 |
| 404 页面 | 全部 | 视觉层级简单但不统一 | 统一空状态和返回入口 | EmptyState | VERIFIED | 空态与返回入口通过 |

## 4. 验证清单

| 页面 | 角色 | UI 已改造 | 功能已回归 | 移动端已检查 | 状态 |
|---|---|---|---|---|---|
| 登录与保护路由 | 全部 | 是 | E2E 保护跳转、单测及构建通过 | 320/390/768/1280 | VERIFIED |
| 首页、工作台、待办、我的 | 员工/店长/管理员 | 是 | 路由、权限与服务测试通过 | 共享框架和底栏检查通过 | VERIFIED |
| 点货、订货、历史 | 员工/店长/管理员 | 是 | V1 计算、服务与历史测试通过 | 320px 样式与触控规则通过 | VERIFIED |
| 到货执行、历史、成功、管理 | 员工/店长/管理员 | 是 | 到货表单、上传、服务与导出测试通过 | 响应式卡片/表格检查通过 | VERIFIED |
| 任务中心、执行、发布、模板、审核 | 员工/店长/管理员 | 是 | 必填校验、图片、周期和服务测试通过 | 操作栏与弹窗安全区检查通过 | VERIFIED |
| 公告、SOP、内容管理 | 员工/店长/管理员 | 是 | 内容服务与保护路由测试通过 | 长文、列表和弹窗规则通过 | VERIFIED |
| 商品、账号、运营统计 | 管理员 | 是 | 商品、账号入口和统计服务测试通过 | 卡片、筛选和表格规则通过 | VERIFIED |
| 错误与 404 | 全部 | 是 | 路由回退与生产构建通过 | 共享状态组件检查通过 | VERIFIED |

## 5. 最终验证记录

- TypeScript：通过。
- ESLint：通过。
- Unit / component / service：34 个测试文件、96 项测试全部通过。
- Playwright E2E：320×720、390×844、768×1024、1280×720 四种视口通过；无横向溢出、无页面运行错误，保护路由均正确返回登录页。
- 视觉截图：四种视口登录页截图已人工检查；测试产物位于 `test-results/ui-review/`，不纳入版本控制。
- Supabase 契约：27 张表、52 条策略校验通过；本轮未修改 migration 或 RLS。
- 安全审计：228 个文件扫描通过。
- 生产构建：Vite 构建通过。
- 版本：`StoreHub v2.1.6`。
