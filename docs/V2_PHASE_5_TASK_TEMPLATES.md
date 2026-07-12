# StoreHub V2 阶段 5：任务模板、周清和巡店

实施分支：`v2-development`

实施日期：2026-07-12

## 1. 阶段范围

本阶段建立 V2 通用任务模板引擎的配置层：

- 管理员创建、编辑、筛选、发布和归档模板；
- 周清、月清、巡店和临时任务四类模板；
- 多门店适用范围、审核要求、逾期规则、周期和默认截止时间；
- 分组和项目编辑；
- 说明、短文本、长文本、整数、小数、是/否、单选、多选、图片、多图片、确认勾选和评分字段；
- 项目必填、图片要求和选择题选项；
- 发布时生成不可变版本快照；
- 员工和店长查看本门店已发布模板。

阶段 6 才创建实际任务实例，并实现填写、自动保存、图片作答、提交、审核、退回和整改。本阶段不提供伪执行按钮或假任务数据。

## 2. V1 隔离

阶段 5 使用全新的表：

- `v2_task_templates`；
- `v2_task_template_stores`；
- `v2_task_template_groups`；
- `v2_task_template_items`；
- `v2_task_template_versions`。

没有修改 V1 `tasks`、`task_items`、点货、订货、历史范围或员工/店长原有页面差异。

## 3. 权限和写入

- 只有管理员可以调用保存、发布和归档 RPC；
- 管理员只能为授权门店配置模板；
- 员工和店长只能读取当前门店的已发布模板；
- 模板表对 `authenticated` 撤销直接 INSERT、UPDATE、DELETE；
- 页面写操作只能调用 `save_v2_task_template`、`publish_v2_task_template` 和 `archive_v2_task_template`；
- 保存和发布写入门店审计日志。

## 4. 版本规则

- 保存现有模板会回到 `draft`；
- 发布时 `current_version + 1`；
- 版本快照保存模板字段、适用门店、分组和全部项目；
- 版本表不提供前端修改权限；
- 后续任务实例必须引用具体版本，不读取可编辑模板作为历史内容。

## 5. 页面

- `/app/admin/task-templates`：管理员模板管理；
- `/app/tasks`：员工和店长的本门店模板准备状态。

员工和店长工作台增加单一“任务中心”入口；管理员首页增加单一“任务模板”入口，没有挤入现有底部导航。

> 后续调整：模板现仅管理员可见。员工和店长只在管理员从模板发布出实际任务后查看和执行任务；详见 [任务可见性、周期截止与图片预览](V2_TASK_VISIBILITY_SCHEDULE_IMAGES.md)。

## 6. 数据库部署与验证

远程 Supabase 已部署：

1. `0013_v2_task_templates.sql`；
2. `0014_v2_task_template_privileges.sql`；
3. `0015_v2_task_template_archive_audit.sql`。

验证覆盖 schema、RLS、RPC、直写权限，以及事务内“管理员保存并发布 v1 → 店长读取当前门店发布版本”。验证数据整体回滚，没有向正式模板表遗留测试记录。

## 7. 回滚

关闭 `VITE_ENABLE_V2_TASK_TEMPLATES` 后按逆序执行：

1. `supabase/rollbacks/0015_v2_task_template_archive_audit.sql`；
2. `supabase/rollbacks/0014_v2_task_template_privileges.sql`；
3. `supabase/rollbacks/0013_v2_task_templates.sql`。

回滚不触碰 V1 或到货模块。

## 8. 下一阶段

下一阶段为阶段 6：任务执行、审核和整改。本轮到此停止。
