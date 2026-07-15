# StoreHub 钉钉考勤模块实施计划

更新时间：2026-07-15  
开发分支：`v2-development`  
目标环境：Development Supabase（`tpbjlzmxpxsydsheeswm`）

## 状态约定

- `TODO`：尚未开始。
- `IN_PROGRESS`：正在实施。
- `DONE`：代码或文档已完成，尚待最终验证。
- `VERIFIED`：自动测试、开发数据库或实际页面验证通过。
- `BLOCKED`：仅因钉钉凭据、开放平台权限或外部后台配置无法继续。

## 开始前审计

| 检查项 | 状态 | 结论 |
|---|---|---|
| Git 与环境边界 | VERIFIED | 当前为 `v2-development`；本地 Supabase CLI 链接 Development 项目；正式项目未连接。 |
| 用户身份 | VERIFIED | `public.profiles.id` 直接引用 `auth.users.id`；角色为 `staff`、`manager`、`admin`。 |
| 门店关系 | VERIFIED | 主门店在 `profiles.store_id`，全部授权门店在 `profile_store_access`；`has_store_access` 作为数据库范围判断。 |
| 角色边界 | VERIFIED | 员工和店长共享 V2 执行能力，但店长不自动获得管理员页面；管理员路由使用 `ProtectedRoute requireAdmin`。 |
| 导航入口 | VERIFIED | 四项底部主菜单固定为首页、工作台、待办、我的；新增业务入口应进入工作台二级卡片。 |
| Migration 与 RLS | VERIFIED | 已有 Migration 最大编号为 `0049`；新增结构必须从 `0050` 开始；所有业务表开启 RLS。 |
| Edge Functions | VERIFIED | 已有 `account-login`、`admin-users`、`task-template-images`；服务端函数使用 Supabase 标准服务端 Secrets。 |
| 时区 | VERIFIED | 现有时间多使用浏览器本地格式；考勤模块将统一使用可配置企业时区，默认 `Asia/Shanghai`。 |
| 测试框架 | VERIFIED | Vitest + Testing Library；Playwright 脚本覆盖 320/390/768/1280 宽度与受保护路由。 |
| 开发环境变量 | VERIFIED | 前端仅包含 Development Supabase URL/Anon Key；钉钉凭据只进入 Edge Function Secrets。 |

## 核心设计决定

1. StoreHub 账号仍由 Supabase Auth 管理；钉钉仅作为第三方员工目录与考勤数据源。
2. 绑定必须由管理员确认。完全一致姓名只产生建议，不自动建立绑定。
3. 原始第三方响应不直接暴露给页面；Edge Function 通过独立 DingTalk Client/Adapter 转换为稳定的内部模型。
4. 日考勤是唯一统计事实来源；月度摘要由数据库 View/RPC 聚合，不保存重复月汇总。
5. 员工和店长都只能查看本人考勤；只有管理员可查看授权门店员工，不复用允许店长管理门店数据的旧权限函数。
6. 所有同步写入由 Service Role 在 Edge Function 内执行；浏览器只读 RLS 数据并调用经过鉴权的同步动作。
7. 同步按最多 50 人、最多 7 天的保守批次切分，并对分页、限流、超时和单人失败做独立重试。
8. 每日自动同步当前月的最近若干天；每月初额外回补上月末。Cron 调用与密钥配置属于外部后台步骤。

## 逐项实施清单

### A. 官方接口与适配器

- `VERIFIED` 核对企业内部应用 Access Token、通讯录、考勤结果、打卡流水和排班接口。
- `VERIFIED` 记录接口路径、权限、分页、人数、日期范围和频率限制。
- `VERIFIED` 实现 Token 缓存、自动刷新、401 重试、429/5xx 指数退避和超时。
- `VERIFIED` 实现通讯录分页、考勤分片、排班合并与内部状态标准化。
- `VERIFIED` 使用 Mock 覆盖 Token、分页、限流、超时、空数据和部分失败。

### B. 数据库与 RLS

- `VERIFIED` 新增 `0050_dingtalk_attendance.sql` 与 `0051_dingtalk_attendance_scope_hardening.sql`，未修改任何旧 Migration。
- `VERIFIED` 新增钉钉员工目录、账号绑定、每日考勤、原始打卡、同步任务和失败项。
- `VERIFIED` 增加唯一约束、Check、外键和查询索引。
- `VERIFIED` 新增安全月度汇总 View/RPC 与绑定操作 RPC。
- `VERIFIED` 员工本人、管理员授权门店、跨门店、匿名拒绝与幂等远端 SQL 测试。

### C. Edge Function 与同步

- `VERIFIED` 新增并部署 Development `dingtalk-attendance` Edge Function。
- `VERIFIED` 实现管理员拉取员工、绑定、解绑、重绑、手动同步与进度结果。
- `VERIFIED` 实现定时同步入口、增量回补、进度游标和失败项日志。
- `VERIFIED` 验证调用者登录、管理员角色和门店范围。
- `VERIFIED` 保证日志不打印 Token、Secret、完整手机号或完整第三方响应。

### D. 前端服务与统计

- `VERIFIED` 增加考勤类型、时间工具、统计服务和中文状态映射。
- `VERIFIED` 覆盖出勤去重、迟到、休息、请假、缺卡、跨日和补卡更新测试。
- `VERIFIED` 增加员工本人月详情、管理员汇总/详情、绑定和同步日志服务。

### E. 员工端

- `VERIFIED` 工作台新增“我的考勤”。
- `VERIFIED` 当前月默认、月份切换、摘要、每日打卡与迟到记录。
- `VERIFIED` 加载、空数据、未绑定、失败和最后同步状态。
- `VERIFIED` 320/390/768/1280 宽度与长内容自动测试。

### F. 管理员端

- `VERIFIED` 工作台新增“考勤管理”。
- `VERIFIED` 月份、门店、员工和状态筛选；增量加载员工汇总。
- `VERIFIED` 员工月度详情、同步进度、结果反馈和同步日志。
- `VERIFIED` 绑定页支持未绑定、已绑定、异常、建议、手动绑定、解绑和重绑。

### G. 自动同步、文档与发布准备

- `VERIFIED` 编写 `DINGTALK_ATTENDANCE_SETUP.md`。
- `VERIFIED` 编写 `DINGTALK_ATTENDANCE_SYNC.md`。
- `VERIFIED` 更新 Edge Function README、路由文档、数据库说明和版本记录。
- `BLOCKED` 在钉钉开放平台创建企业内部应用并授权。
- `BLOCKED` 在 Development Supabase 写入钉钉 Secrets并创建 Cron；函数代码已部署。

### H. 最终验证

- `VERIFIED` Migration 安全检查、开发库 dry-run/push、远端 Migration 对齐。
- `VERIFIED` 数据库/RLS 集成测试。
- `VERIFIED` TypeScript、lint、全量 Vitest、Playwright E2E 和生产构建。
- `VERIFIED` 确认构建只含 Development Supabase URL。
- `VERIFIED` 提交并推送 `v2-development`；不得合并 `manage-system`。

## 回滚原则

- 前端可通过撤销本次提交恢复入口和页面。
- 数据库使用单独回滚说明，仅删除本模块对象；正式发布前不得在正式数据库执行。
- 已同步业务数据不通过 `reset`、`truncate` 或无条件清理处理。
- Edge Function 可独立下线，数据库本地只读页面仍能展示最后一次成功同步结果。
