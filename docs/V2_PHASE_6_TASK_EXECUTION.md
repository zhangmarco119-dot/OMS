# StoreHub V2 阶段 6：任务执行、审核和整改

实施分支：`v2-development`

## 范围

- 管理员从模板当前不可变版本向授权门店发布任务；
- 员工和店长共享本门店任务列表、通用字段填写、800ms 自动保存、图片上传和提交；
- 管理员查看逐项答案，通过或填写原因并指定整改项目；
- 被退回任务保留审核记录，可整改并重新提交；
- 任务、答案、图片和审核使用独立 `v2_task_*` 表，不修改 V1 `tasks/task_items`。

## 状态

`pending → in_progress → submitted → approved/rejected → resubmitted → approved/rejected`，并保留 `overdue/cancelled` 扩展状态。

## 安全

所有核心写入通过 `publish_v2_tasks`、`save_v2_task_progress`、`submit_v2_task` 和 `review_v2_task` RPC；RLS 限制员工/店长当前门店和管理员授权门店。任务图片使用私有 `v2-task-images` bucket。

## 路由

- `/app/tasks`、`/app/tasks/:taskId`：门店执行；
- `/app/admin/tasks`、`/app/admin/tasks/:taskId`：发布和审核。

## 数据库

远程部署 `0016_v2_task_execution.sql` 和字段/图片必填校验修正 `0017_v2_task_submission_validation.sql`，阶段 6 整体回滚使用 `0016` 回滚脚本。

## 下一阶段

阶段 7 为公告和 SOP，本轮到此停止。
