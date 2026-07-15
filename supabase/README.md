# Supabase 数据库说明

本目录包含 V1 基线以及 StoreHub V2 各阶段数据库交付物：

- `migrations/0001_initial_schema.sql`：表结构、约束、索引、触发器、RLS helper function、RLS policy。
- `seed.sql`：两家门店和少量脱敏商品测试数据。
- `migrations/0010_arrival_reports.sql`：StoreHub V2 到货表、索引、RPC、RLS、私有 Storage bucket 和 policy。
- `rollbacks/0010_arrival_reports.sql`：到货模块安全回滚；bucket 非空时拒绝执行。
- `tests/0010_arrival_schema.sql`：migration 应用后的数据库 catalog smoke test。
- `migrations/0011_save_arrival_draft.sql`：原子草稿保存 RPC 和到货核心表直写权限收紧。
- `rollbacks/0011_save_arrival_draft.sql`：恢复阶段 2 的草稿直写权限。
- `tests/0011_arrival_draft_rpc.sql`：原子草稿 RPC 和数据库权限 smoke test。
- `migrations/0012_arrival_report_returning_rls.sql`：修复创建草稿时 `INSERT ... RETURNING` 的行级读取策略。
- `rollbacks/0012_arrival_report_returning_rls.sql`：恢复原到货主表读取策略。
- `tests/0012_arrival_report_returning_rls.sql`：防止读取策略再次通过主表自查询判断新行。
- `migrations/0013_v2_task_templates.sql`：阶段 5 模板、适用门店、分组、项目、不可变版本、RLS 和 RPC。
- `migrations/0014_v2_task_template_privileges.sql`：显式撤销模板表直写权限，强制写操作经过 RPC。
- `migrations/0015_v2_task_template_archive_audit.sql`：为模板归档补充逐门店审计日志。
- `rollbacks/0013_v2_task_templates.sql` 至 `0015_v2_task_template_archive_audit.sql`：阶段 5 逆序回滚。
- `tests/0013_v2_task_templates.sql`：模板 schema、RLS、RPC 和权限 smoke test。
- `migrations/0016_v2_task_execution.sql`：任务实例、答案、私有图片、审核状态机及执行/审核 RPC。
- `rollbacks/0016_v2_task_execution.sql`、`tests/0016_v2_task_execution.sql`：阶段 6 回滚与 smoke test。
- `migrations/0017_v2_task_submission_validation.sql`：按字段类型和图片元数据执行必填校验。
- `migrations/0018_v2_task_visibility_schedule_and_images.sql`：模板管理员可见性、周期截止日和下一次截止时间计算。
- `migrations/0019_v2_task_schedule_helper_privileges.sql`：禁止前端直接调用周期截止时间计算辅助函数。
- `migrations/0020_v2_recurring_task_schedules.sql`：每 N 天 / 每周指定日期的周期任务计划、自动推送定时调度和暂停机制。
- `migrations/0021_admin_operation_overview.sql`：管理员首页的到货、盘点和 V2 任务概览汇总 RPC。
- `migrations/0022_v2_monthly_task_schedules.sql`：周期任务的每月固定日期规则。
- `migrations/0049_system_user_manuals.sql`：管理员在线说明文档表、初始元数据和仅管理员可读写的 RLS。

## 在线使用说明同步

两份独立 HTML 保存在 `docs/`，应用从 `public.v2_system_documents` 读取最新正文。应用 `0049` 后执行：

```powershell
$env:STOREHUB_DOCUMENT_ADMIN_IDENTIFIER = '<管理员账号名>'
$env:STOREHUB_DOCUMENT_ADMIN_PASSWORD = '<管理员密码>'
pnpm manuals:sync -- --env development
```

脚本会校验目标项目必须与所选环境一致，再同步员工与店长说明、管理员说明。正式环境还必须显式使用 `--env production --allow-production`，且正式环境的 URL、Anon Key 和项目 Ref 必须通过环境变量提供。账号和密钥只能临时放入环境变量，禁止写入仓库。

## 本地/远程执行顺序

1. 在 Supabase 创建项目。
2. 执行 `migrations/0001_initial_schema.sql`。
3. 执行 `seed.sql`。
4. 在 Supabase Auth 中创建测试用户。
5. 把 Auth 用户 ID 写入 `public.profiles`，绑定 `store_id` 和 `role`。
6. 管理员账号如需管理门店，在 `public.admin_store_access` 添加授权行。
7. 用不同用户 token 验证 RLS 越权访问失败。

V2 增量在已有 `0001–0009` 的项目上按顺序执行：

1. `0010_arrival_reports.sql`；
2. `0011_save_arrival_draft.sql`；
3. `0012_arrival_report_returning_rls.sql`；
4. `0013_v2_task_templates.sql`；
5. `0014_v2_task_template_privileges.sql`；
6. `0015_v2_task_template_archive_audit.sql`。
7. `0016_v2_task_execution.sql`。
8. `0017_v2_task_submission_validation.sql`。

## Bootstrap 管理员

publishable key 不能创建管理员账号。第一次管理员需要在 Supabase Dashboard 中创建 Auth 用户，然后插入 profile：

```sql
insert into public.profiles (id, store_id, username, display_name, role)
values (
  '<admin-auth-user-uuid>',
  '00000000-0000-4000-8000-000000000001',
  'admin',
  '管理员',
  'admin'
);

insert into public.admin_store_access (admin_profile_id, store_id)
values
  ('<admin-auth-user-uuid>', '00000000-0000-4000-8000-000000000001'),
  ('<admin-auth-user-uuid>', '00000000-0000-4000-8000-000000000002');
```

之后可在应用后台继续创建和维护账号。

## 测试用户建议

不要把真实密码提交到仓库。建议在 Supabase Dashboard 中手动创建以下测试用户：

| 用户 | 角色 | 门店 |
|---|---|---|
| `baozhu_staff@example.test` | `staff` | 宝珠奶酪（五道口店） |
| `omega_staff@example.test` | `staff` | OMEGA酸奶（西直门店） |
| `baozhu_manager@example.test` | `manager` | 宝珠奶酪（五道口店） |
| `admin@example.test` | `admin` | 任一主门店，并通过 `admin_store_access` 授权 |

创建 Auth 用户后，按实际 Auth UUID 插入 profiles。示例：

```sql
insert into public.profiles (id, store_id, username, display_name, role)
values
  ('<auth-user-uuid>', '00000000-0000-4000-8000-000000000001', 'baozhu_staff', '宝珠员工', 'staff');
```

## 静态验证

```powershell
.\scripts\use-pnpm.ps1 validate:supabase
```

该命令检查关键表、`store_id`、RLS、策略、helper function、seed 数据和前端环境变量边界。它不能替代真实 Supabase RLS 集成测试。
