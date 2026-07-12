# StoreHub V2 阶段 4：管理员到货中心

实施分支：`v2-development`

实施日期：2026-07-12

## 1. 阶段范围

本阶段完成管理员专用的到货管理闭环：

- 管理员首页今日上报、未读消息、到货门店和产品种类统计；
- 带面单缩略图的未读到货消息，点击后标记查看并进入详情；
- 授权门店范围内的到货列表、日期/门店/状态筛选和分页；
- 手机卡片、筛选抽屉和桌面表格；
- 到货基础信息、两类图片、产品明细、备注、状态和操作日志详情；
- 标记查看、填写原因并二次确认作废；
- 单条记录 Excel 导出；
- 按日期和门店筛选的每日明细、产品汇总和 Excel 导出。

阶段 5 的任务模板、周清和巡店不在本轮范围内。

## 2. 页面与路由

- `/app/admin/arrivals`：管理员到货消息和记录列表；
- `/app/admin/arrivals/:reportId`：管理员到货详情；
- `/app/admin/arrivals/summary`：每日到货汇总。

三条路由均使用 `requireAdmin`，员工和店长不能访问。管理员底部导航增加单一“到货”入口，V1 消息、记录、后台和账号入口保持不变。

## 3. 数据与权限

- 页面查询集中在 `src/services/admin-arrivals.service.ts`；
- 读取继续受 `has_store_access` 和到货 RLS 限制；
- 标记查看只调用 `mark_arrival_viewed`；
- 作废只调用 `void_arrival_report`，页面不直写状态；
- 作废记录由数据库 View 排除，不进入每日汇总；
- 图片继续使用私有 bucket 的短时签名 URL；
- 本阶段未修改 V1 `tasks`、`task_items`、历史范围或员工/店长权限。

## 4. Excel

单条记录包含 `到货信息`、`产品明细`、`操作日志`。每日汇总包含 `到货明细`、`产品汇总`，文件名遵循 `到货汇总_YYYY-MM-DD.xlsx`。

## 5. 数据库部署

远程 Supabase 已按顺序部署：

1. `supabase/migrations/0010_arrival_reports.sql`；
2. `supabase/migrations/0011_save_arrival_draft.sql`；
3. `supabase/migrations/0012_arrival_report_returning_rls.sql`。

`0012` 修复 PostgREST 创建草稿并返回新行时的 RLS 自查询问题。数据库 smoke test、当前门店 `INSERT ... RETURNING` 和跨门店拒绝均已在远程项目验证；V1 `0001–0009` 未修改或回退。

## 6. 下一阶段

下一阶段为阶段 5：任务模板、周清和巡店。本轮到此停止。
