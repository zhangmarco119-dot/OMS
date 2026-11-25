# 代码、路由与数据库静态索引

生成日期：2026-11-25。基于当前仓库源文件，不含业务数据或秘密。数据库类型不是实时 DDL；迁移列表是历史变更而非最终对象定义。当前 SSH 状态见总指南。

## 领域入口对照

|领域|页面/逻辑|服务/数据库入口|
|---|---|---|
|身份/账号|[src/features/auth/AuthContext.tsx](../../src/features/auth/AuthContext.tsx)|[supabase/functions/account-login/index.ts](../../supabase/functions/account-login/index.ts)|
|工作台菜单|[src/pages/AppMenuPage.tsx](../../src/pages/AppMenuPage.tsx)|[src/features/access/roleCapabilities.ts](../../src/features/access/roleCapabilities.ts)|
|V1 点货/订货|[src/features/tasks/useTaskSession.ts](../../src/features/tasks/useTaskSession.ts)|[src/features/tasks/taskService.ts](../../src/features/tasks/taskService.ts)|
|V1 历史|[src/pages/HistoryTaskDetailPage.tsx](../../src/pages/HistoryTaskDetailPage.tsx)|[src/features/history/historyService.ts](../../src/features/history/historyService.ts)|
|V2 模板|[src/pages/AdminTaskTemplatesPage.tsx](../../src/pages/AdminTaskTemplatesPage.tsx)|[src/services/task-templates.service.ts](../../src/services/task-templates.service.ts)|
|V2 发布/审批|[src/pages/AdminV2TasksPage.tsx](../../src/pages/AdminV2TasksPage.tsx)|[src/services/v2-tasks.service.ts](../../src/services/v2-tasks.service.ts)|
|V2 员工执行|[src/pages/V2TaskExecutionPage.tsx](../../src/pages/V2TaskExecutionPage.tsx)|[src/features/v2-tasks/taskCompletion.ts](../../src/features/v2-tasks/taskCompletion.ts)|
|到货录入|[src/pages/ArrivalEntryPage.tsx](../../src/pages/ArrivalEntryPage.tsx)|[src/services/arrivals.service.ts](../../src/services/arrivals.service.ts)|
|到货单品汇总|[src/pages/AdminArrivalSummaryPage.tsx](../../src/pages/AdminArrivalSummaryPage.tsx)|[src/services/admin-arrivals.service.ts](../../src/services/admin-arrivals.service.ts)|
|货品登记|[src/pages/ProductRegistrationPage.tsx](../../src/pages/ProductRegistrationPage.tsx)|[src/services/product-registration.service.ts](../../src/services/product-registration.service.ts)|
|员工/税务|[src/pages/AdminTaxAccountingPage.tsx](../../src/pages/AdminTaxAccountingPage.tsx)|[src/services/tax-accounting.service.ts](../../src/services/tax-accounting.service.ts)|
|管理员账号|[src/pages/AdminPage.tsx](../../src/pages/AdminPage.tsx)|[supabase/functions/admin-users/index.ts](../../supabase/functions/admin-users/index.ts)|
|考勤|[src/pages/AdminAttendancePage.tsx](../../src/pages/AdminAttendancePage.tsx)|[src/services/attendance.service.ts](../../src/services/attendance.service.ts)|
|钉钉同步|[supabase/functions/dingtalk-attendance/index.ts](../../supabase/functions/dingtalk-attendance/index.ts)|[supabase/functions/dingtalk-attendance/incremental-plan.ts](../../supabase/functions/dingtalk-attendance/incremental-plan.ts)|
|薪资/处罚/规则|[src/pages/AdminPayrollPage.tsx](../../src/pages/AdminPayrollPage.tsx)|[src/services/payroll.service.ts](../../src/services/payroll.service.ts)|
|员工工资单|[src/pages/MyPayrollPage.tsx](../../src/pages/MyPayrollPage.tsx)|[src/features/payroll/PayrollStatementView.tsx](../../src/features/payroll/PayrollStatementView.tsx)|
|工时登记|[src/pages/OvertimePage.tsx](../../src/pages/OvertimePage.tsx)|[src/services/payroll.service.ts](../../src/services/payroll.service.ts)|
|工资统计|[src/services/payroll-statistics.service.ts](../../src/services/payroll-statistics.service.ts)|[src/features/payroll/payrollStatisticsImage.ts](../../src/features/payroll/payrollStatisticsImage.ts)|
|公告/SOP|[src/pages/AdminContentPage.tsx](../../src/pages/AdminContentPage.tsx)|[src/services/v2-content.service.ts](../../src/services/v2-content.service.ts)|
|SOP 渐进图片|[src/features/content/SopProgressiveImage.tsx](../../src/features/content/SopProgressiveImage.tsx)|[src/features/content/sopImageDelivery.ts](../../src/features/content/sopImageDelivery.ts)|
|待办|[src/pages/TodoPage.tsx](../../src/pages/TodoPage.tsx)|[src/services/todo.service.ts](../../src/services/todo.service.ts)|
|操作日志|[src/pages/AdminOperationLogsPage.tsx](../../src/pages/AdminOperationLogsPage.tsx)|[src/services/operation-logs.service.ts](../../src/services/operation-logs.service.ts)|
|营业状态|[src/services/store-business.service.ts](../../src/services/store-business.service.ts)|[supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)|
|收银|[supabase/functions/pospal-sales/index.ts](../../supabase/functions/pospal-sales/index.ts)|[supabase/functions/qmai-sales/index.ts](../../supabase/functions/qmai-sales/index.ts)|
|AI|[src/pages/AdminAiReviewPage.tsx](../../src/pages/AdminAiReviewPage.tsx)|[supabase/functions/ai-review/index.ts](../../supabase/functions/ai-review/index.ts)|
|图片缓存/错误|[src/lib/imageResourceCache.ts](../../src/lib/imageResourceCache.ts)|[src/config/release.ts](../../src/config/release.ts)|
|更新/回滚|[src/features/release/ReleaseUpdateGuard.tsx](../../src/features/release/ReleaseUpdateGuard.tsx)|[src/services/release-control.service.ts](../../src/services/release-control.service.ts)|
|备份|[ops/local-backup.py](../../ops/local-backup.py)|[ops/local-backup-bridge.py](../../ops/local-backup-bridge.py)|

## 当前路由

以下 `/app` 子路径来自 router.tsx；是否 requireAdmin / requireTaskReviewer 必须读对应路由与服务器权限，不能只按路径推断。

- `/`
- `/phase-1`
- `/login`
- `/app`
- `/app/messages`
- `/app/inventory`
- `/app/order`
- `/app/arrivals`
- `/app/arrivals/history`
- `/app/arrivals/corrections/:requestId/review`
- `/app/arrivals/:reportId/correct`
- `/app/arrivals/:reportId/success`
- `/app/arrivals/:reportId`
- `/app/tasks`
- `/app/tasks/:taskId`
- `/app/notices`
- `/app/notices/:noticeId`
- `/app/sops`
- `/app/sops/:sopId`
- `/app/history`
- `/app/history/:taskId`
- `/app/operations-history`
- `/app/attendance`
- `/app/payroll`
- `/app/payroll-confirmations/:payslipId`
- `/app/overtime`
- `/app/operation-reports`
- `/app/operation-reports/:reportId`
- `/app/product-registrations`
- `/app/account`
- `/app/account/about`
- `/app/account/about/manual/:manualSlug`
- `/app/menu`
- `/app/manager/employees`
- `/app/workbench`
- `/app/todos`
- `/app/admin`
- `/app/admin/products`
- `/app/admin/product-registrations`
- `/app/admin/ai-review`
- `/app/admin/products/correction-task`
- `/app/admin/users`
- `/app/admin/arrivals`
- `/app/admin/arrivals/summary`
- `/app/admin/arrivals/:reportId`
- `/app/admin/task-templates`
- `/app/admin/tasks`
- `/app/admin/tasks/publish`
- `/app/admin/tasks/:taskId`
- `/app/admin/content`
- `/app/admin/announcements`
- `/app/admin/sops`
- `/app/admin/analytics`
- `/app/admin/attendance`
- `/app/admin/attendance/:profileId`
- `/app/admin/payroll`
- `/app/admin/tax-accounting`
- `/app/admin/operation-logs`
- `/admin`
- `/app/*`

## public 表类型：89 个

以下为 Row 类型字段，Insert/Update/Relationships 和嵌套 Json 请直接读 [src/types/database.ts](../../src/types/database.ts)。此处不展开敏感字段内容。

### `profile_store_assignment_periods`

```typescript
{ id: string; profile_id: string; store_id: string; effective_from: string; effective_to: string | null; updated_by: string | null; created_at: string }
```

### `attendance_audit_logs`

```typescript
{ action: 'binding_created' | 'binding_removed' | 'binding_replaced' | 'sync_requested' | 'sync_retried'; actor_id: string | null; created_at: string; entity_id: string; entity_type: 'binding' | 'sync_job'; id: string; metadata: Json; store_id: string | null }
```

### `attendance_daily_records`

```typescript
{ actual_off_at: string | null; actual_on_at: string | null; attendance_date: string; corp_id: string; created_at: string; daily_status: 'normal' | 'late' | 'early' | 'missing' | 'pending' | 'rest' | 'leave' | 'business_trip' | 'fieldwork' | 'abnormal'; data_source: 'dingtalk'; dingtalk_result_ids: string[]; early_minutes: number; enterprise_timezone: string; exception_note: string | null; id: string; is_attended: boolean; last_synced_at: string; late_minutes: number; missing_punch: 'none' | 'on' | 'off' | 'both'; off_duty_result: string; on_duty_result: string; planned_off_at: string | null; planned_on_at: string | null; profile_id: string; shift_id: string | null; shift_name: string | null; source_updated_at: string | null; store_id: string; updated_at: string }
```

### `attendance_missing_punch_todos`

```typescript
{ attendance_date: string; completed_at: string | null; created_at: string; due_at: string; id: string; missing_punch: 'on' | 'off' | 'both'; profile_id: string; status: 'pending' | 'completed'; store_id: string; updated_at: string }
```

### `payroll_visibility_settings`

```typescript
{ history_available_until_day: number; history_months: number; id: boolean; updated_at: string; updated_by: string | null }
```

### `attendance_punch_records`

```typescript
{ check_type: 'on_duty' | 'off_duty' | 'unknown'; corp_id: string; created_at: string; daily_record_id: string; dingtalk_record_id: string; id: string; is_approved_correction: boolean; last_synced_at: string; location_name: string | null; location_result: string | null; profile_id: string; punch_time: string; source_type: string | null; store_id: string; time_result: string | null; updated_at: string }
```

### `attendance_sync_failures`

```typescript
{ attempt_count: number; created_at: string; dingtalk_user_id: string | null; error_code: string | null; error_message: string; id: string; profile_id: string | null; resolved_at: string | null; retryable: boolean; stage: 'directory' | 'schedule' | 'result' | 'punch' | 'normalize' | 'persist'; sync_job_id: string }
```

### `attendance_sync_jobs`

```typescript
{ corp_id: string; created_at: string; error_summary: string | null; failure_count: number; finished_at: string | null; id: string; initiated_by: string | null; inserted_count: number; month_start: string | null; profile_id: string | null; progress_cursor: Json; range_end: string | null; range_start: string | null; scope_type: 'organization' | 'store' | 'employee'; skipped_count: number; started_at: string | null; status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'; store_id: string | null; success_count: number; sync_type: 'directory' | 'current_month' | 'month' | 'date_range' | 'employee' | 'history_month'; trigger_type: 'manual' | 'scheduled' | 'retry'; updated_at: string; updated_count: number }
```

### `dingtalk_employee_bindings`

```typescript
{ binding_status: 'active' | 'inactive' | 'error'; corp_id: string; created_at: string; created_by: string | null; dingtalk_user_id: string; directory_user_id: string; error_message: string | null; id: string; last_verified_at: string | null; match_source: 'manual' | 'name_suggestion' | 'imported'; profile_id: string; store_id: string; union_id: string | null; updated_at: string }
```

### `dingtalk_enterprises`

```typescript
{ corp_id: string; created_at: string; display_name: string; is_active: boolean; last_directory_synced_at: string | null; updated_at: string }
```

### `dingtalk_store_enterprise_bindings`

```typescript
{ corp_id: string; created_at: string; created_by: string | null; id: string; is_active: boolean; store_id: string; updated_at: string }
```

### `dingtalk_employee_directory`

```typescript
{ corp_id: string; created_at: string; department_ids: string[]; dingtalk_user_id: string; display_name: string; id: string; is_active: boolean; job_number: string | null; last_synced_at: string; mobile_masked: string | null; union_id: string | null; updated_at: string }
```

### `arrival_report_images`

```typescript
{
          arrival_item_id: string | null;
          bucket: string;
          created_at: string;
          file_name: string;
          height: number | null;
          id: string;
          image_type: 'waybill' | 'goods';
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          object_path: string;
          report_id: string;
          size_bytes: number;
          store_id: string;
          uploaded_by: string;
          width: number | null;
        }
```

### `arrival_report_items`

```typescript
{
          created_at: string;
          id: string;
          is_unmatched_product: boolean;
          note: string | null;
          product_id: string | null;
          product_name_snapshot: string;
          quantity: number;
          report_id: string;
          sort_order: number;
          unit: string;
          updated_at: string;
        }
```

### `arrival_reports`

```typescript
{
          arrival_date: string;
          arrival_time: string | null;
          carrier_name: string | null;
          created_at: string;
          generated_summary: string;
          id: string;
          note: string | null;
          report_no: string;
          reported_by: string;
          reporter_name_snapshot: string;
          status: 'draft' | 'submitted' | 'viewed' | 'voided';
          store_id: string;
          store_name_snapshot: string;
          submission_key: string | null;
          submitted_at: string | null;
          tracking_no: string | null;
          updated_at: string;
          version: number;
          viewed_at: string | null;
          viewed_by: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        }
```

### `arrival_report_correction_requests`

```typescript
{
          created_at: string;
          id: string;
          original_version: number;
          proposed_fields: Json;
          proposed_items: Json;
          report_id: string;
          requested_by: string;
          requester_role: 'staff' | 'manager';
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: 'pending' | 'approved' | 'rejected';
          store_id: string;
          updated_at: string;
        }
```

### `admin_store_access`

```typescript
{
          admin_profile_id: string;
          created_at: string;
          store_id: string;
        }
```

### `audit_logs`

```typescript
{
          action: string;
          actor_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_table: string;
          id: string;
          metadata: Json;
          store_id: string | null;
        }
```

### `admin_task_reads`

```typescript
{
          admin_profile_id: string;
          read_at: string;
          task_id: string;
        }
```

### `notifications`

```typescript
{
          body: string;
          created_at: string;
          dedupe_key: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          is_read: boolean;
          read_at: string | null;
          recipient_role: 'staff' | 'manager' | 'admin' | null;
          recipient_user_id: string | null;
          store_id: string | null;
          title: string;
          type: string;
        }
```

### `profile_product_permissions`

```typescript
{ can_request_discontinued: boolean; can_request_incorrect: boolean; can_request_new: boolean; profile_id: string; updated_at: string; updated_by: string | null; }
```

### `v2_notices`

```typescript
{ body: string; created_at: string; created_by: string; expires_at: string | null; id: string; is_pinned: boolean; published_at: string | null; requires_acknowledgment: boolean; retracted_at: string | null; status: 'draft' | 'published' | 'retracted' | 'archived'; title: string; updated_at: string; }
```

### `v2_notice_stores`

```typescript
{ created_at: string; notice_id: string; store_id: string; }
```

### `v2_notice_reads`

```typescript
{ notice_id: string; profile_id: string; read_at: string; }
```

### `v2_notice_recipients`

```typescript
{ acknowledged_at: string | null; created_at: string; dismissed_at: string | null; first_read_at: string | null; last_read_at: string | null; notice_id: string; profile_id: string; role_snapshot: 'staff' | 'manager'; store_id: string; }
```

### `v2_notice_assets`

```typescript
{ bucket: 'v2-notice-assets'; created_at: string; file_name: string; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; notice_id: string; object_path: string; size_bytes: number; uploaded_by: string; }
```

### `v2_sops`

```typescript
{ body: string; category: string; created_at: string; created_by: string; effective_at: string | null; id: string; published_at: string | null; status: 'draft' | 'published' | 'archived'; task_template_id: string | null; title: string; updated_at: string; version: number; }
```

### `v2_sop_favorites`

```typescript
{ created_at: string; profile_id: string; sop_id: string }
```

### `v2_system_documents`

```typescript
{ audience: 'staff_manager' | 'admin'; content_html: string; document_version: string; slug: string; summary: string; title: string; updated_at: string; updated_by: string | null; }
```

### `system_release_control`

```typescript
{ active_release: string; allowed_releases: string[]; check_interval_seconds: number; enforcement_mode: 'off' | 'warn' | 'block'; message: string; minimum_database_contract: number; singleton: boolean; updated_at: string; updated_by: string | null }
```

### `v2_sop_stores`

```typescript
{ created_at: string; sop_id: string; store_id: string; }
```

### `v2_sop_roles`

```typescript
{ created_at: string; role: 'staff' | 'manager'; sop_id: string; }
```

### `v2_sop_categories`

```typescript
{ created_at: string; created_by: string | null; id: string; is_active: boolean; name: string; sort_order: number; updated_at: string; }
```

### `v2_sop_assets`

```typescript
{ asset_kind: 'step' | 'cover' | 'attachment'; bucket: 'v2-sop-assets'; created_at: string; file_name: string | null; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null; object_path: string | null; size_bytes: number; sop_id: string; sort_order: number; step_text: string; uploaded_by: string; }
```

### `product_feedback`

```typescript
{
          created_at: string;
          created_by: string;
          feedback_type: 'discontinued' | 'archived' | 'incorrect' | 'new';
          handled_at: string | null;
          handled_by: string | null;
          id: string;
          note: string | null;
          original_snapshot: Json;
          product_id: string | null;
          resolution_note: string | null;
          status: 'open' | 'resolved' | 'ignored' | 'reverted';
          store_id: string;
          suggested_changes: Json;
          task_item_id: string;
        }
```

### `products`

```typescript
{
          category_code: 'fruit' | 'frozen' | 'other_food' | 'packaging' | 'consumable' | 'non_consumable';
          count_unit: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          product_code: string | null;
          sort_order: number;
          spec: string;
          store_id: string;
          updated_at: string;
        }
```

### `product_categories`

```typescript
{ code: 'fruit' | 'frozen' | 'other_food' | 'packaging' | 'consumable' | 'non_consumable'; created_at: string; label: string; sort_order: number }
```

### `product_creation_requests`

```typescript
{ arrival_item_id: string; category_code: 'fruit' | 'frozen' | 'other_food' | 'packaging' | 'consumable' | 'non_consumable'; count_unit: string; created_at: string; id: string; name: string; product_id: string | null; report_id: string; requested_by: string; review_note: string | null; reviewed_at: string | null; reviewed_by: string | null; spec: string; status: 'pending' | 'approved' | 'rejected'; store_id: string; updated_at: string }
```

### `product_registration_entries`

```typescript
{ created_at: string; created_by: string; id: string; note: string; product_id: string | null; product_name: string; quantity: number | null; registration_type: 'packaging' | 'abandoned' | 'loaned_to_wudaokou' | 'equipment' | 'other'; status: 'draft' | 'completed'; store_id: string; unit: string; updated_at: string }
```

### `product_registration_images`

```typescript
{ bucket: 'product-registration-images'; created_at: string; entry_id: string; file_name: string; height: number | null; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp'; object_path: string; size_bytes: number; store_id: string; uploaded_by: string; width: number | null }
```

### `profiles`

```typescript
{
          created_at: string;
          deleted_at: string | null;
          display_name: string;
          employment_type: 'full_time' | 'part_time';
          id: string;
          is_active: boolean;
          role: 'staff' | 'manager' | 'admin';
          store_id: string;
          updated_at: string;
          username: string;
        }
```

### `payroll_employee_rules`

```typescript
{ commission_enabled: boolean; commission_rate: number | null; confirmed: boolean; created_at: string; created_by: string | null; effective_from: string; effective_to: string | null; extra_reward_amount: number; full_attendance_bonus_days: number | null; extra_attendance_bonus_days: number | null; full_attendance_bonus_amount: number; full_attendance_bonus_enabled: boolean; full_performance_amount: number | null; housing_enabled: boolean; id: string; monthly_base_salary: number; monthly_housing_allowance: number; performance_enabled: boolean; performance_override_amount: number; performance_override_enabled: boolean; profile_id: string; change_reason: string; regularization_date: string | null; service_award_amount: number; service_award_enabled: boolean }
```

### `payroll_employee_departure_months`

```typescript
{ created_at: string; payroll_month: string; profile_id: string; updated_by: string }
```

### `payroll_attendance_allocation_rules`

```typescript
{ created_at: string; effective_from: string; effective_to: string | null; is_enabled: boolean; profile_id: string; punch_scope: 'any' | 'on_duty' | 'off_duty'; source_store_id: string; target_ratio: number; target_store_id: string; updated_at: string; updated_by: string | null }
```

### `payroll_employee_commission_stores`

```typescript
{ created_at: string; rule_id: string; store_id: string }
```

### `payroll_performance_rules`

```typescript
{ attendance_weight: number; change_reason: string; created_at: string; created_by: string | null; discipline_weight: number; effective_from: string; effective_to: string | null; grade_a_coefficient: number; grade_a_min: number; grade_b_coefficient: number; grade_b_min: number; grade_c_coefficient: number; grade_c_min: number; grade_d_coefficient: number; id: string; late_deduction_1_10: number; late_deduction_11_20: number; late_deduction_21_30: number; late_deduction_31_plus: number; task_weight: number }
```

### `dingtalk_api_calls`

```typescript
{ action: string; corp_id: string; created_at: string; endpoint: string; id: number; usage_date: string }
```

### `system_operation_logs`

```typescript
{ actor_employment_type_snapshot: 'full_time' | 'part_time' | null; actor_id: string | null; actor_name_snapshot: string; actor_role_snapshot: 'staff' | 'manager' | 'admin' | 'system'; actor_username_snapshot: string | null; entity_id: string | null; entity_type: string; id: string; metadata: Json; module: string; occurred_at: string; operation: 'created' | 'updated' | 'deleted' | 'login' | 'viewed'; store_id: string | null; summary: string }
```

### `payroll_performance_overrides`

```typescript
{ created_at: string; created_by: string; id: string; payroll_month: string; performance_score: number; profile_id: string; updated_at: string }
```

### `payroll_employee_performance_stores`

```typescript
{ allocation_ratio: number; created_at: string; rule_id: string; store_id: string }
```

### `payroll_store_performance_overrides`

```typescript
{ created_at: string; override_mode: 'automatic' | 'score' | 'grade'; payroll_month: string; performance_grade: 'A' | 'B' | 'C' | 'D' | null; performance_score: number | null; profile_id: string; store_id: string; updated_at: string; updated_by: string }
```

### `payroll_default_performance_settings`

```typescript
{ profile_id: string; default_grade: 'A' | 'B' | 'C' | 'D'; effective_from: string; updated_by: string | null; updated_at: string }
```

### `payroll_performance_amount_overrides`

```typescript
{ amount: number; created_at: string; payroll_month: string; profile_id: string; updated_at: string; updated_by: string }
```

### `payroll_individual_tax_overrides`

```typescript
{ amount: number; created_at: string; payroll_month: string; profile_id: string; updated_at: string; updated_by: string }
```

### `payroll_store_revenues`

```typescript
{ confirmed_amount: number; created_at: string; id: string; note: string; revenue_date: string; source: 'manual' | 'pospal' | 'qmai'; source_reference_id: string | null; source_updated_at: string | null; store_id: string; updated_at: string; updated_by: string }
```

### `payroll_store_revenue_inputs`

```typescript
{ as_of_date: string; created_at: string; id: string; input_mode: 'pos_sync' | 'manual'; manual_cumulative_amount: number | null; note: string; store_id: string; updated_at: string; updated_by: string }
```

### `payroll_penalties`

```typescript
{ amount: number; created_at: string; created_by: string; event_date: string; event_level: 'reminder' | 'warning' | 'formal_warning' | 'serious'; id: string; performance_deduction: number; profile_id: string; reason: string; revoke_reason: string | null; status: 'active' | 'revoked'; updated_at: string }
```

### `payroll_overtime_rates`

```typescript
{ change_reason: string; created_at: string; created_by: string | null; effective_from: string; effective_to: string | null; hourly_rate: number; id: string }
```

### `payroll_overtime_requests`

```typescript
{ approved_hourly_rate: number | null; created_at: string; hours: number; id: string; overtime_date: string; profile_id: string; reason: string; review_note: string | null; reviewed_at: string | null; reviewed_by: string | null; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; store_id: string; updated_at: string }
```

### `payroll_payslips`

```typescript
{ admin_note: string; confirmation_assignee_id: string | null; confirmation_target: 'employee' | 'manager'; confirmed_at: string | null; confirmed_by: string | null; created_at: string; delegated_at: string | null; delegated_by: string | null; estimate_snapshot: Json; id: string; issue_source: 'scheduled' | 'admin'; issued_at: string | null; issued_by: string | null; last_modified_by: string | null; payroll_month: string; profile_id: string; revision: number; status: 'draft' | 'issued' | 'confirmed' | 'withdrawn'; store_id: string | null; updated_at: string; withdrawn_at: string | null; withdrawn_by: string | null }
```

### `payroll_payslip_schedule_settings`

```typescript
{ created_at: string; day_of_month: number; enabled: boolean; frequency_months: number; id: number; last_issued_month: string | null; last_run_at: string | null; send_time: string; updated_at: string; updated_by: string | null }
```

### `payroll_penalty_assets`

```typescript
{ bucket: 'payroll-evidence'; created_at: string; file_name: string; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp'; object_path: string; penalty_id: string; size_bytes: number; uploaded_by: string }
```

### `pos_sales_integrations`

```typescript
{ configured_at: string; configured_by: string; created_at: string; display_name: string; enabled: boolean; external_account: string; external_credential_id: string | null; external_store_id: string | null; id: string; last_error: string | null; last_success_at: string | null; last_sync_at: string | null; next_sync_at: string | null; provider: 'pospal' | 'qmai'; store_id: string; sync_end_hour: number; sync_interval_minutes: number; sync_start_hour: number; updated_at: string }
```

### `pos_sales_sync_jobs`

```typescript
{ api_call_count: number; created_at: string; error_message: string | null; fetched_count: number; finished_at: string | null; id: string; initiated_by: string | null; integration_id: string; page_count: number; provider: 'pospal' | 'qmai'; revenue_amount: number | null; started_at: string; status: 'running' | 'succeeded' | 'failed'; store_id: string; sync_date: string; sync_end_date: string; trigger_type: 'manual' | 'scheduled'; valid_count: number }
```

### `pos_sales_tickets`

```typescript
{ created_at: string; external_key: string; external_order_no: string | null; external_sn: string | null; id: string; integration_id: string; invalid: boolean; occurred_at: string; order_no: string | null; order_source: string | null; order_total_amount: number | null; platform_sequence: string | null; product_summary: string | null; remark: string | null; revenue_date: string; sell_ticket_uid: string | null; source_updated_at: string | null; store_id: string; sync_job_id: string | null; ticket_type: 'SELL' | 'SELL_RETURN'; total_amount: number; updated_at: string; web_order_no: string | null }
```

### `operation_report_refund_reasons`

```typescript
{ created_at: string; created_by: string | null; display_order: number; id: string; is_active: boolean; label: string; normalized_label: string; updated_at: string }
```

### `operation_report_templates`

```typescript
{ created_at: string; enabled: boolean; fields: Json; id: string; refund_note: string; store_id: string; title: string; updated_at: string; updated_by: string | null }
```

### `operation_reports`

```typescript
{ attendance_sync_job_id: string | null; computed_data: Json; created_at: string; created_by: string; field_config_snapshot: Json; id: string; manual_values: Json; refund_entries: Json; refund_note_snapshot: string; refresh_started_at: string | null; report_date: string; sales_sync_job_id: string | null; source_synced_at: string | null; status: 'draft' | 'submitted'; store_id: string; submitted_at: string | null; text_report: string | null; title_snapshot: string; updated_at: string }
```

### `operation_report_images`

```typescript
{ bucket: 'operation-report-images'; created_at: string; field_id: string; file_name: string; height: number | null; id: string; mime_type: 'image/jpeg' | 'image/png' | 'image/webp'; object_path: string; report_id: string; size_bytes: number; store_id: string; uploaded_by: string; width: number | null }
```

### `profile_store_access`

```typescript
{
          created_at: string;
          profile_id: string;
          store_id: string;
        }
```

### `tax_reporting_monthly_salaries`

```typescript
{
          created_at: string;
          manual_amount: number | null;
          note: string;
          payroll_month: string;
          person_id: string;
          updated_at: string;
          updated_by: string;
        }
```

### `tax_reporting_store_settings`

```typescript
{
          company_name: string;
          created_at: string;
          store_id: string;
          updated_at: string;
          updated_by: string | null;
        }
```

### `tax_reporting_people`

```typescript
{
          bank_card_number: string | null;
          bank_name: string | null;
          contact_address: string | null;
          created_at: string;
          created_by: string;
          full_name: string;
          id: string;
          id_card_image_path: string | null;
          id_number: string | null;
          is_active: boolean;
          phone: string | null;
          profile_id: string | null;
          reporting_store_id: string | null;
          updated_at: string;
          updated_by: string;
        }
```

### `store_business_closures`

```typescript
{ id: string; store_id: string; closed_from: string; reopened_from: string | null; resume_sales_sync: boolean; updated_by: string; updated_at: string }
```

### `stores`

```typescript
{
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          short_name: string;
        }
```

### `task_items`

```typescript
{
          created_at: string;
          id: string;
          is_extra_item: boolean;
          product_action_status: 'deletion_requested' | 'deletion_approved' | 'deletion_ignored' | 'archive_requested' | 'archive_approved' | 'archive_ignored' | null;
          product_id: string | null;
          product_snapshot: Json;
          quantity: number | null;
          sort_order: number;
          staff_note: string | null;
          status: 'pending' | 'completed' | 'no_order_needed';
          store_id: string;
          task_id: string;
          updated_at: string;
        }
```

### `v2_task_answers`

```typescript
{ answer: Json | null; group_id: string; id: string; is_issue: boolean; item_id: string; item_snapshot: Json; last_reviewed_at: string | null; last_reviewed_by: string | null; note: string; review_status: 'pending' | 'approved' | 'rejected' | 'resubmitted'; submission_round: number; task_id: string; updated_at: string; updated_by: string | null }
```

### `v2_task_item_reviews`

```typescript
{ actor_id: string; created_at: string; decision: 'approved' | 'rejected'; id: string; item_id: string; note: string; submission_round: number; task_id: string }
```

### `v2_task_images`

```typescript
{ bucket: string; created_at: string; file_name: string; id: string; item_id: string; mime_type: string; object_path: string; size_bytes: number; store_id: string; task_id: string; uploaded_by: string }
```

### `v2_task_reviews`

```typescript
{ action: 'submitted' | 'approved' | 'rejected' | 'resubmitted'; actor_id: string; correction_item_ids: string[]; created_at: string; id: string; inventory_correction_item_ids: string[]; note: string; task_id: string }
```

### `v2_task_categories`

```typescript
{ code: string; created_at: string; created_by: string | null; is_system: boolean; label: string }
```

### `v2_task_schedules`

```typescript
{ acceptance_interval_days: number | null; acceptance_month_day: number | null; acceptance_type: 'daily' | 'weekly' | 'monthly'; acceptance_weekday: number | null; assigned_profile_id: string | null; completion_mode: 'shared' | 'individual' | 'single' | 'selected'; content_name: string | null; content_snapshot: Json | null; created_at: string; created_by: string; due_time: string; id: string; interval_days: number | null; inventory_category_codes: ('fruit' | 'frozen' | 'other_food' | 'packaging' | 'consumable' | 'non_consumable')[]; is_active: boolean; last_published_at: string | null; manager_review_enabled: boolean; month_day: number | null; next_due_at: string; paused_at: string | null; paused_by: string | null; publish_time: string; recipient_group_id: string; related_content_title: string | null; related_notice_id: string | null; related_sop_id: string | null; requires_inventory: boolean; schedule_type: 'interval_days' | 'weekly' | 'monthly'; store_id: string; target_audiences: ('staff' | 'manager' | 'part_time')[]; template_id: string; template_version_id: string; updated_at: string; weekdays: number[]; withdrawn_at: string | null; withdrawn_by: string | null }
```

### `v2_tasks`

```typescript
{ allow_overdue: boolean; assigned_profile_id: string | null; category: string; correction_item_ids: string[]; created_at: string; created_by: string; due_at: string; id: string; inventory_category_codes: ('fruit' | 'frozen' | 'other_food' | 'packaging' | 'consumable' | 'non_consumable')[]; inventory_correction_item_ids: string[]; inventory_correction_task_id: string | null; manager_review_enabled: boolean; name: string; publish_at: string; publish_notified_at: string | null; related_content_title: string | null; related_notice_id: string | null; related_sop_id: string | null; requires_inventory: boolean; requires_review: boolean; review_note: string | null; reviewed_at: string | null; reviewed_by: string | null; schedule_id: string | null; snapshot: Json; started_at: string | null; started_by: string | null; status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'resubmitted' | 'overdue' | 'cancelled'; store_id: string; submission_key: string | null; submitted_at: string | null; submitted_by: string | null; submitted_by_role: 'staff' | 'manager' | 'admin' | null; target_audiences: ('staff' | 'manager' | 'part_time')[]; task_no: string; template_id: string; template_version_id: string; updated_at: string; version: number }
```

### `v2_task_template_groups`

```typescript
{ description: string; id: string; sort_order: number; template_id: string; title: string }
```

### `v2_task_template_items`

```typescript
{
          field_type: 'instruction' | 'short_text' | 'long_text' | 'integer' | 'decimal' | 'boolean' | 'single_choice' | 'multi_choice' | 'image' | 'multi_image' | 'confirmation' | 'rating';
          group_id: string; guidance: string; id: string;
          image_requirement: 'none' | 'single' | 'multiple'; is_required: boolean;
          label: string; minimum_image_count: number | null; options: Json; reference_image_path: string | null; reference_image_paths: string[]; sort_order: number; template_id: string;
        }
```

### `v2_task_template_stores`

```typescript
{ created_at: string; store_id: string; template_id: string }
```

### `v2_task_template_versions`

```typescript
{ id: string; published_at: string; published_by: string; snapshot: Json; template_id: string; version_number: number }
```

### `v2_task_templates`

```typescript
{
          allow_overdue: boolean; category: string;
          created_at: string; created_by: string; current_version: number; description: string;
          due_time: string | null; id: string; name: string; recurrence: 'none' | 'weekly' | 'monthly'; recurrence_day: number | null;
          requires_review: boolean; status: 'draft' | 'published' | 'archived'; updated_at: string;
        }
```

### `tasks`

```typescript
{
          created_at: string;
          created_by: string;
          export_meta: Json;
          id: string;
          inventory_category_codes: ('fruit' | 'frozen' | 'other_food' | 'packaging' | 'consumable' | 'non_consumable')[];
          inventory_recount_only: boolean;
          linked_v2_task_id: string | null;
          started_at: string;
          status: 'draft' | 'review' | 'submitted' | 'cancelled';
          store_id: string;
          submitted_at: string | null;
          task_type: 'inventory' | 'order';
          updated_at: string;
        }
```

## 前端声明 RPC：199 个

完整函数体/权限以迁移及在线 pg_get_functiondef 为准，前端类型未覆盖所有 private/service 函数。

- `admin_save_payroll_custom_items` — `{ Args: { p_profile_id: string; p_payroll_month: string; p_items: Json }; Returns: Json }`
- `list_admin_arrivals_v1` — `{ Args: { p_date_from?: string | null; p_date_to?: string | null; p_store_id?: string | null; p_status?: string; p_page?: number; p_page_size?: number }; Returns: Json }`
- `list_admin_arrivals_v2` — `{ Args: { p_date_from?: string | null; p_date_to?: string | null; p_store_id?: string | null; p_status?: string; p_product_search?: string | null; p_page?: number; p_page_size?: number }; Returns: Json }`
- `get_product_matching_settings` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `admin_save_product_matching_settings` — `{ Args: { p_history_match_days: number; p_recommendation_days: number }; Returns: Json }`
- `list_recommended_product_additions` — `{ Args: { p_store_id: string }; Returns: Json }`
- `admin_create_recommended_products` — `{ Args: { p_products: Json; p_store_id: string }; Returns: Json }`
- `normalize_product_name` — `{ Args: { p_name: string }; Returns: string }`
- `record_system_activity` — `{ Args: { p_module: string; p_view: string; p_period?: string | null; p_store_id?: string | null; p_target_profile_id?: string | null; p_context?: Json }; Returns: string }`
- `list_system_operation_log_actors` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `get_system_release_policy` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `configure_system_release_policy` — `{ Args: { p_active_release: string; p_allowed_releases: string[]; p_minimum_database_contract?: number; p_enforcement_mode?: string; p_check_interval_seconds?: number; p_message?: string }; Returns: Json }`
- `admin_save_operation_report_template` — `{ Args: { p_enabled: boolean; p_fields: Json; p_refund_note: string; p_store_id: string; p_title: string }; Returns: Json }`
- `save_operation_report_refund_reason` — `{ Args: { p_label: string }; Returns: Json }`
- `admin_update_operation_report_refund_reason` — `{ Args: { p_id: string; p_label: string }; Returns: Json }`
- `admin_delete_operation_report_refund_reason` — `{ Args: { p_id: string }; Returns: undefined }`
- `begin_operation_report_refresh` — `{ Args: { p_report_date: string; p_store_id: string }; Returns: Json }`
- `get_operation_report_availability` — `{ Args: { p_store_id: string }; Returns: Json }`
- `get_dingtalk_api_usage` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `admin_set_dingtalk_api_daily_limit` — `{ Args: { p_limit: number }; Returns: Json }`
- `get_attendance_incremental_schedule` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `admin_save_attendance_incremental_schedule` — `{ Args: { p_enabled: boolean; p_times: string[] }; Returns: Json }`
- `prepare_operation_report` — `{ Args: { p_attendance_sync_job_id: string | null; p_report_date: string; p_sales_sync_job_id: string; p_store_id: string }; Returns: Json }`
- `release_operation_report_refresh` — `{ Args: { p_report_id: string }; Returns: undefined }`
- `save_operation_report_draft` — `{ Args: { p_manual_values: Json; p_refund_entries: Json; p_report_id: string }; Returns: Json }`
- `submit_operation_report` — `{ Args: { p_manual_values: Json; p_refund_entries: Json; p_report_id: string; p_text_report: string }; Returns: Json }`
- `admin_attendance_month` — `{ Args: { p_limit?: number; p_month: string; p_offset?: number; p_search?: string; p_status?: string; p_store_id?: string | null }; Returns: Json }`
- `complete_attendance_missing_punch_todo` — `{ Args: { p_todo_id: string }; Returns: Json }`
- `confirm_my_payroll_payslip` — `{ Args: { p_payslip_id: string }; Returns: Json }`
- `confirm_delegated_payroll_payslip` — `{ Args: { p_payslip_id: string }; Returns: Json }`
- `admin_issue_payroll_payslips` — `{ Args: { p_payroll_month: string; p_profile_ids?: string[] | null }; Returns: Json }`
- `admin_generate_payroll_payslips` — `{ Args: { p_payroll_month: string; p_profile_ids?: string[] | null }; Returns: Json }`
- `admin_send_payroll_payslip` — `{ Args: { p_payslip_id: string }; Returns: Json }`
- `admin_send_payroll_payslip_to_manager` — `{ Args: { p_manager_id: string; p_payslip_id: string }; Returns: Json }`
- `admin_send_payroll_payslips` — `{ Args: { p_payslip_ids: string[] }; Returns: Json }`
- `admin_update_payroll_payslip` — `{ Args: { p_fields: Json; p_payslip_id: string }; Returns: Json }`
- `get_payroll_deduction_items` — `{ Args: { p_from: string; p_profile_id: string; p_to: string }; Returns: Json }`
- `admin_withdraw_payroll_payslip` — `{ Args: { p_payslip_id: string }; Returns: Json }`
- `admin_withdraw_payroll_payslips` — `{ Args: { p_payslip_ids: string[] }; Returns: Json }`
- `list_available_payroll_confirmation_managers` — `{ Args: { p_payslip_id: string }; Returns: Json }`
- `admin_payroll_estimates` — `{ Args: { p_as_of?: string; p_search?: string; p_store_id?: string | null }; Returns: Json }`
- `admin_create_payroll_penalty` — `{ Args: { p_fields: Json }; Returns: Json }`
- `admin_save_payroll_employee_rule` — `{ Args: { p_fields: Json; p_profile_id: string; p_store_ids?: string[] }; Returns: string }`
- `admin_save_payroll_employee_rule_v2` — `{ Args: { p_commission_store_ids?: string[]; p_fields: Json; p_performance_stores?: Json; p_profile_id: string }; Returns: string }`
- `admin_save_payroll_attendance_allocation_rule` — `{ Args: { p_effective_from: string; p_effective_to?: string | null; p_is_enabled?: boolean; p_profile_id: string; p_punch_scope: 'any' | 'on_duty' | 'off_duty'; p_source_store_id: string; p_target_ratio: number; p_target_store_id: string }; Returns: string }`
- `admin_save_payroll_monthly_performance` — `{ Args: { p_final_amount?: number | null; p_payroll_month: string; p_profile_id: string; p_store_settings?: Json }; Returns: Json }`
- `admin_save_payroll_visibility_settings` — `{ Args: { p_history_available_until_day: number; p_history_months: number }; Returns: Json }`
- `admin_save_payroll_overtime_rate` — `{ Args: { p_change_reason?: string; p_effective_from: string; p_hourly_rate: number }; Returns: string }`
- `admin_record_payroll_overtime` — `{ Args: { p_hours: number; p_overtime_date: string; p_profile_id: string; p_reason?: string; p_store_id: string }; Returns: Json }`
- `admin_save_payroll_performance_rule` — `{ Args: { p_fields: Json }; Returns: string }`
- `admin_save_payroll_performance_override` — `{ Args: { p_payroll_month: string; p_performance_score?: number | null; p_profile_id: string }; Returns: Json }`
- `admin_get_payroll_individual_tax_override` — `{ Args: { p_payroll_month: string; p_profile_id: string }; Returns: number | null }`
- `admin_save_payroll_individual_tax_override` — `{ Args: { p_amount?: number | null; p_payroll_month: string; p_profile_id: string }; Returns: Json }`
- `admin_save_payroll_individual_taxes` — `{ Args: { p_entries: Json; p_payroll_month: string }; Returns: Json }`
- `admin_payroll_statistics_inputs` — `{ Args: { p_from: string; p_to: string }; Returns: Json }`
- `configure_attendance_automation` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `get_attendance_automation_settings` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `admin_save_attendance_automation_settings` — `{ Args: { p_enabled: boolean; p_end_time: string; p_interval_minutes: number; p_start_time: string }; Returns: Json }`
- `configure_pos_sales_integration` — `{ Args: { p_enabled: boolean; p_end_hour: number; p_integration_id: string; p_interval_minutes: number; p_start_hour: number }; Returns: Json }`
- `bind_qmai_sales_integration` — `{ Args: { p_credential_id: string; p_shop_code: string; p_shop_id: string; p_shop_name: string; p_store_id: string }; Returns: Json }`
- `configure_qmai_sales_integration` — `{ Args: { p_enabled: boolean; p_end_hour: number; p_integration_id: string; p_interval_minutes: number; p_start_hour: number }; Returns: Json }`
- `replace_pos_sales_range` — `{ Args: { p_api_call_count: number; p_end_date: string; p_integration_id: string; p_start_date: string; p_sync_job_id: string; p_tickets: Json }; Returns: Json }`
- `replace_qmai_sales_range` — `{ Args: { p_api_call_count: number; p_end_date: string; p_integration_id: string; p_start_date: string; p_sync_job_id: string; p_tickets: Json }; Returns: Json }`
- `save_payroll_store_revenue_input` — `{ Args: { p_as_of_date: string; p_input_mode: string; p_manual_cumulative_amount?: number | null; p_note?: string; p_store_id: string }; Returns: Json }`
- `get_attendance_month_detail` — `{ Args: { p_month: string; p_profile_id: string; p_store_id?: string | null }; Returns: Json }`
- `get_payroll_estimate` — `{ Args: { p_as_of?: string; p_profile_id: string }; Returns: Json }`
- `get_payroll_visibility_settings` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `get_payroll_payslip_schedule_settings` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `admin_save_payroll_payslip_schedule_settings` — `{ Args: { p_day_of_month: number; p_enabled: boolean; p_frequency_months: number; p_send_time: string }; Returns: Json }`
- `payroll_overtime_todo_count` — `{ Args: Record<PropertyKey, never>; Returns: number }`
- `review_payroll_overtime_request` — `{ Args: { p_action: string; p_note?: string; p_request_id: string }; Returns: Json }`
- `submit_payroll_overtime_request` — `{ Args: { p_hours: number; p_overtime_date: string; p_reason?: string; p_store_id: string }; Returns: Json }`
- `update_payroll_overtime_request` — `{ Args: { p_hours: number; p_overtime_date: string; p_reason?: string; p_request_id: string; p_store_id: string }; Returns: Json }`
- `get_v2_sop_detail` — `{ Args: { p_sop_id: string }; Returns: Json }`
- `list_v2_sop_cards` — `{ Args: { p_archived?: boolean; p_category?: string; p_favorites_only?: boolean; p_limit?: number; p_offset?: number; p_search?: string }; Returns: Json }`
- `list_publishable_v2_task_templates` — `{ Args: Record<PropertyKey, never>; Returns: Json }`
- `rename_v2_task_template` — `{ Args: { p_name: string; p_template_id: string }; Returns: Json }`
- `attach_v2_task_template_reference_image` — `{ Args: { p_item_id: string; p_path: string; p_template_id: string }; Returns: string[] }`
- `admin_set_product_permissions` — `{ Args: { p_can_request_discontinued: boolean; p_can_request_incorrect: boolean; p_can_request_new: boolean; p_profile_id: string }; Returns: Json }`
- `acknowledge_v2_notice` — `{ Args: { p_notice_id: string }; Returns: Json }`
- `archive_v2_notice` — `{ Args: { p_notice_id: string }; Returns: Json }`
- `admin_v2_analytics` — `{ Args: { p_days?: number; p_end_date?: string; p_start_date?: string }; Returns: Json }`
- `delete_v2_notice` — `{ Args: { p_notice_id: string }; Returns: Json }`
- `delete_archived_v2_sop` — `{ Args: { p_sop_id: string }; Returns: Json }`
- `delete_v2_sop_category` — `{ Args: { p_category_id: string }; Returns: Json }`
- `delete_archived_v2_task_template` — `{ Args: { p_template_id: string }; Returns: Json }`
- `archive_v2_sop` — `{ Args: { p_sop_id: string }; Returns: Json }`
- `can_manage_v2_notice` — `{ Args: { p_notice_id: string }; Returns: boolean }`
- `can_manage_v2_sop` — `{ Args: { p_sop_id: string }; Returns: boolean }`
- `can_manage_v2_task_content_asset` — `{ Args: { p_asset_id: string }; Returns: boolean }`
- `can_read_v2_notice` — `{ Args: { p_notice_id: string }; Returns: boolean }`
- `can_read_v2_sop` — `{ Args: { p_sop_id: string }; Returns: boolean }`
- `can_edit_v2_task` — `{ Args: { p_task_id: string }; Returns: boolean }`
- `can_review_v2_task` — `{ Args: { p_task_id: string }; Returns: boolean }`
- `can_request_product_feedback` — `{ Args: { p_feedback_type: string }; Returns: boolean }`
- `can_read_v2_task` — `{ Args: { p_task_id: string }; Returns: boolean }`
- `admin_operation_overview` — `{ Args: Record<PropertyKey, never>; Returns: { arrival_pending: number; arrival_today: number; inventory_completed_today: number; inventory_pending: number; v2_task_active: number; v2_task_completed: number }[] }`
- `create_v2_task_schedule` — `{ Args: { p_first_due_at: string; p_interval_days: number | null; p_month_day: number | null; p_profile_ids: string[]; p_schedule_type: string; p_store_ids: string[]; p_template_id: string; p_weekdays: number[] }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `create_v2_task_schedule_v2` — `{ Args: { p_fields: Json; p_profile_ids: string[]; p_store_ids: string[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `get_v2_task_schedule_content` — `{ Args: { p_schedule_id: string }; Returns: Json }`
- `update_v2_task_schedule_v2` — `{ Args: { p_fields: Json; p_schedule_id: string }; Returns: Json }`
- `withdraw_v2_task_schedule_current` — `{ Args: { p_schedule_id: string }; Returns: Json }`
- `create_v2_task_category` — `{ Args: { p_label: string }; Returns: Json }`
- `delete_v2_task_category` — `{ Args: { p_code: string }; Returns: Json }`
- `create_v2_sop_text_step` — `{ Args: { p_sop_id: string; p_sort_order: number; p_step_text: string }; Returns: Json }`
- `pause_v2_task_schedule` — `{ Args: { p_schedule_id: string }; Returns: Json }`
- `mark_v2_notice_read` — `{ Args: { p_notice_id: string }; Returns: Json }`
- `publish_v2_notice` — `{ Args: { p_notice_id: string }; Returns: Json }`
- `publish_v2_sop` — `{ Args: { p_sop_id: string }; Returns: Json }`
- `publish_v2_sop_with_options` — `{ Args: { p_silent: boolean; p_sop_id: string }; Returns: Json }`
- `publish_v2_tasks` — `{ Args: { p_due_at: string | null; p_profile_ids: string[]; p_store_ids: string[]; p_target_audiences: ('staff' | 'manager' | 'part_time')[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `update_v2_task_recipients` — `{ Args: { p_mode: 'shared' | 'single' | 'individual'; p_profile_ids: string[]; p_target_audiences: ('staff' | 'manager' | 'part_time')[]; p_task_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `publish_v2_tasks_v2` — `{ Args: { p_due_at: string; p_manager_review_enabled?: boolean; p_profile_ids?: string[]; p_publish_at?: string; p_store_ids: string[]; p_target_audiences?: ('staff' | 'manager' | 'part_time')[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `publish_v2_tasks_v3` — `{ Args: { p_due_at: string; p_manager_review_enabled?: boolean; p_profile_ids?: string[]; p_publish_at?: string; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_store_ids: string[]; p_target_audiences?: ('staff' | 'manager' | 'part_time')[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `publish_v2_tasks_v4` — `{ Args: { p_due_at: string; p_inventory_category_codes?: string[]; p_manager_review_enabled?: boolean; p_profile_ids?: string[]; p_publish_at?: string; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_requires_inventory?: boolean; p_store_ids: string[]; p_target_audiences?: ('staff' | 'manager' | 'part_time')[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `create_v2_task_schedule_v5` — `{ Args: { p_completion_mode?: 'shared' | 'individual' | 'single' | 'selected'; p_fields: Json; p_inventory_category_codes?: string[]; p_profile_ids: string[]; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_requires_inventory?: boolean; p_store_ids: string[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `update_v2_task_schedule_all_v4` — `{ Args: { p_completion_mode?: 'shared' | 'individual' | 'single' | 'selected'; p_fields: Json; p_inventory_category_codes?: string[]; p_name: string; p_profile_ids?: string[]; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_requires_inventory?: boolean; p_schedule_id: string; p_snapshot: Json; p_target_audiences?: ('staff' | 'manager' | 'part_time')[] }; Returns: Json }`
- `create_v2_task_schedule_v3` — `{ Args: { p_fields: Json; p_profile_ids: string[]; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_store_ids: string[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `create_v2_task_schedule_v4` — `{ Args: { p_fields: Json; p_inventory_category_codes?: string[]; p_profile_ids: string[]; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_requires_inventory?: boolean; p_store_ids: string[]; p_template_id: string }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `update_v2_task_content` — `{ Args: { p_due_at: string | null; p_name: string; p_snapshot: Json; p_task_id: string }; Returns: Json }`
- `update_v2_task_content_v2` — `{ Args: { p_due_at: string | null; p_manager_review_enabled: boolean; p_name: string; p_snapshot: Json; p_task_id: string }; Returns: Json }`
- `update_v2_task_content_v3` — `{ Args: { p_due_at: string | null; p_manager_review_enabled: boolean; p_name: string; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_snapshot: Json; p_task_id: string }; Returns: Json }`
- `update_v2_task_content_v4` — `{ Args: { p_due_at: string | null; p_inventory_category_codes?: string[]; p_manager_review_enabled: boolean; p_name: string; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_requires_inventory?: boolean; p_snapshot: Json; p_task_id: string }; Returns: Json }`
- `update_v2_task_schedule_all` — `{ Args: { p_fields: Json; p_name: string; p_schedule_id: string; p_snapshot: Json }; Returns: Json }`
- `update_v2_task_schedule_all_v2` — `{ Args: { p_fields: Json; p_name: string; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_schedule_id: string; p_snapshot: Json }; Returns: Json }`
- `update_v2_task_schedule_all_v3` — `{ Args: { p_fields: Json; p_inventory_category_codes?: string[]; p_name: string; p_related_notice_id?: string | null; p_related_sop_id?: string | null; p_requires_inventory?: boolean; p_schedule_id: string; p_snapshot: Json }; Returns: Json }`
- `update_product_category` — `{ Args: { p_category_code: string; p_product_id: string }; Returns: Database['public']['Tables']['products']['Row'] }`
- `set_inventory_task_categories` — `{ Args: { p_category_codes: string[]; p_task_id: string }; Returns: Database['public']['Tables']['tasks']['Row'] }`
- `create_linked_inventory_task` — `{ Args: { p_v2_task_id: string }; Returns: Database['public']['Tables']['tasks']['Row'] }`
- `configure_v2_tasks_inventory` — `{ Args: { p_category_codes?: string[]; p_enabled: boolean; p_task_ids: string[] }; Returns: number }`
- `request_arrival_product_creation` — `{ Args: { p_report_id: string; p_requests: Json }; Returns: Database['public']['Tables']['product_creation_requests']['Row'][] }`
- `review_product_creation_request` — `{ Args: { p_action: string; p_note?: string | null; p_request_id: string }; Returns: Database['public']['Tables']['product_creation_requests']['Row'] }`
- `review_product_creation_request_v2` — `{ Args: { p_action: string; p_category_code?: string | null; p_count_unit?: string | null; p_name?: string | null; p_note?: string | null; p_request_id: string; p_spec?: string | null }; Returns: Database['public']['Tables']['product_creation_requests']['Row'] }`
- `list_admin_products_with_last_inventory` — `{ Args: { p_store_id: string }; Returns: Json }`
- `publish_product_correction_tasks` — `{ Args: { p_due_at: string; p_items: Json; p_manager_review_enabled?: boolean; p_profile_ids?: string[]; p_publish_at?: string; p_store_id: string; p_target_audiences?: ('staff' | 'manager' | 'part_time')[] }; Returns: Database['public']['Tables']['v2_tasks']['Row'][] }`
- `update_v2_task_schedule_content` — `{ Args: { p_name: string; p_schedule_id: string; p_snapshot: Json }; Returns: Json }`
- `withdraw_v2_task_schedule` — `{ Args: { p_schedule_id: string }; Returns: Json }`
- `admin_bind_dingtalk_employee` — `{ Args: { p_directory_user_id: string; p_match_source?: string; p_profile_id: string; p_store_id?: string | null }; Returns: Json }`
- `admin_remove_dingtalk_store_enterprise` — `{ Args: { p_mapping_id: string }; Returns: Json }`
- `admin_save_dingtalk_store_enterprise` — `{ Args: { p_corp_id: string; p_display_name: string; p_store_id: string }; Returns: Json }`
- `admin_unbind_dingtalk_employee` — `{ Args: { p_binding_id: string }; Returns: Json }`
- `resume_v2_task_schedule` — `{ Args: { p_schedule_id: string }; Returns: Json }`
- `reorder_v2_sop_assets` — `{ Args: { p_asset_ids: string[]; p_sop_id: string }; Returns: Json }`
- `rename_v2_sop_category` — `{ Args: { p_category_id: string; p_new_name: string }; Returns: Json }`
- `review_v2_task` — `{ Args: { p_action: string; p_correction_item_ids: string[]; p_note: string; p_task_id: string }; Returns: Json }`
- `review_v2_task_items` — `{ Args: { p_decisions: Json; p_note: string; p_task_id: string }; Returns: Json }`
- `review_v2_task_items_with_inventory` — `{ Args: { p_decisions: Json; p_inventory_rejected_item_ids?: string[]; p_inventory_task_id: string; p_note: string; p_task_id: string }; Returns: Json }`
- `review_v2_tasks_batch` — `{ Args: { p_task_ids: string[]; p_action: string; p_note?: string }; Returns: Json }`
- `withdraw_v2_task` — `{ Args: { p_task_id: string }; Returns: Json }`
- `retract_v2_notice` — `{ Args: { p_notice_id: string }; Returns: Json }`
- `retract_v2_task_template` — `{ Args: { p_template_id: string }; Returns: Json }`
- `retract_v2_sop` — `{ Args: { p_sop_id: string }; Returns: Json }`
- `unarchive_v2_sop` — `{ Args: { p_sop_id: string }; Returns: Json }`
- `save_v2_notice` — `{ Args: { p_fields: Json; p_notice_id: string | null; p_store_ids: string[] }; Returns: Json }`
- `save_v2_sop` — `{ Args: { p_fields: Json; p_roles: string[]; p_sop_id: string | null; p_store_ids: string[] }; Returns: Json }`
- `save_v2_task_progress` — `{ Args: { p_answers: Json; p_expected_version: number; p_task_id: string }; Returns: Json }`
- `submit_v2_task` — `{ Args: { p_expected_version: number; p_key: string; p_task_id: string }; Returns: Json }`
- `submit_v2_task_with_answers` — `{ Args: { p_answers: Json; p_expected_version: number; p_key: string; p_task_id: string }; Returns: Json }`
- `archive_v2_task_template` — `{ Args: { p_template_id: string }; Returns: Json; }`
- `can_manage_v2_task_template` — `{ Args: { target_template_id: string }; Returns: boolean; }`
- `can_view_v2_task_template` — `{ Args: { target_template_id: string }; Returns: boolean; }`
- `publish_v2_task_template` — `{ Args: { p_template_id: string }; Returns: Json; }`
- `save_v2_task_template` — `{ Args: { p_fields: Json; p_groups: Json; p_store_ids: string[]; p_template_id: string | null }; Returns: Json; }`
- `set_v2_task_template_minimum_image_counts` — `{ Args: { p_counts: Json; p_template_id: string }; Returns: undefined; }`
- `can_edit_arrival_report` — `{ Args: { target_report_id: string }; Returns: boolean; }`
- `reset_arrival_draft` — `{ Args: { p_expected_version: number; p_report_id: string }; Returns: Json; }`
- `admin_update_arrival_report` — `{ Args: { p_fields: Json; p_items: Json; p_report_id: string }; Returns: Json; }`
- `submit_arrival_correction_request` — `{ Args: { p_fields: Json; p_items: Json; p_report_id: string }; Returns: Json; }`
- `review_arrival_correction_request` — `{ Args: { p_approve: boolean; p_note?: string | null; p_request_id: string }; Returns: Json; }`
- `can_operate_arrival_modules` — `{ Args: { target_store_id: string }; Returns: boolean; }`
- `can_read_arrival_image_object` — `{ Args: { p_object_name: string }; Returns: boolean; }`
- `can_read_arrival_report` — `{ Args: { target_report_id: string }; Returns: boolean; }`
- `can_write_arrival_image_object` — `{ Args: { p_object_name: string }; Returns: boolean; }`
- `can_manage_store` — `{ Args: { target_store_id: string }; Returns: boolean; }`
- `admin_set_store_operating` — `{ Args: { p_store_id: string; p_operating: boolean; p_effective_date: string }; Returns: string | null }`
- `store_is_operating_on` — `{ Args: { p_store_id: string; p_date: string }; Returns: boolean }`
- `admin_set_profile_stores` — `{ Args: { p_profile_id: string; p_store_ids: string[] }; Returns: undefined; }`
- `admin_end_profile_store` — `{ Args: { p_profile_id: string; p_store_id: string; p_effective_date: string }; Returns: undefined; }`
- `can_modify_task` — `{ Args: { target_task_id: string }; Returns: boolean; }`
- `can_view_task` — `{ Args: { target_task_id: string }; Returns: boolean; }`
- `current_user_role` — `{ Args: Record<PropertyKey, never>; Returns: 'staff' | 'manager' | 'admin' | null; }`
- `switch_current_store` — `{ Args: { p_store_id: string }; Returns: string; }`
- `current_user_store_id` — `{ Args: Record<PropertyKey, never>; Returns: string | null; }`
- `has_store_access` — `{ Args: { target_store_id: string }; Returns: boolean; }`
- `manager_update_product_from_task` — `{ Args: { p_task_item_id: string; p_name: string; p_spec: string; p_count_unit: string; p_product_code?: string | null; p_note?: string | null; }; Returns: Json; }`
- `manager_request_product_deletion` — `{ Args: { p_task_item_id: string; p_note?: string | null; }; Returns: string; }`
- `manager_request_product_archive` — `{ Args: { p_task_item_id: string; p_note?: string | null; }; Returns: string; }`
- `manager_add_product_from_task` — `{ Args: { p_task_id: string; p_name: string; p_spec: string; p_count_unit: string; p_quantity: number; p_product_code?: string | null; p_note?: string | null; }; Returns: Json; }`
- `list_store_inventory_templates` — `{ Args: { p_limit?: number }; Returns: Array<{ task_id: string; submitted_at: string | null; created_by: string; created_by_name: string; total_count: number; processed_count: number; pending_count: number; }>; }`
- `import_inventory_task` — `{ Args: { p_target_task_id: string; p_source_task_id: string; }; Returns: Json; }`
- `generate_arrival_report_no` — `{ Args: Record<PropertyKey, never>; Returns: string; }`
- `generate_arrival_summary` — `{ Args: { target_report_id: string }; Returns: string; }`
- `mark_arrival_viewed` — `{ Args: { p_report_id: string }; Returns: Json; }`
- `reopen_voided_arrival_report` — `{ Args: { p_report_id: string }; Returns: Json; }`
- `save_arrival_draft` — `{ Args: { p_expected_version: number; p_fields: Json; p_items: Json; p_report_id: string; }; Returns: Json; }`
- `submit_arrival_report` — `{ Args: { p_expected_version: number; p_idempotency_key: string; p_report_id: string; }; Returns: Json; }`
- `submit_arrival_report_with_product_requests` — `{ Args: { p_expected_version: number; p_idempotency_key: string; p_report_id: string; p_requests?: Json; }; Returns: Json; }`
- `void_arrival_report` — `{ Args: { p_reason: string; p_report_id: string }; Returns: Json; }`
- `admin_handle_product_feedback` — `{ Args: { p_feedback_id: string; p_action: string; p_resolution_note?: string | null; }; Returns: Json; }`

## 完整 Migration 清单：188 份

不得修改已应用历史文件。编号相同不代表函数体仍等于最早版本。

- [supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- [supabase/migrations/0002_manager_product_workflow.sql](../../supabase/migrations/0002_manager_product_workflow.sql)
- [supabase/migrations/0003_enforce_product_workflow_rls.sql](../../supabase/migrations/0003_enforce_product_workflow_rls.sql)
- [supabase/migrations/0004_manager_add_product_workflow.sql](../../supabase/migrations/0004_manager_add_product_workflow.sql)
- [supabase/migrations/0005_repair_manager_added_products.sql](../../supabase/migrations/0005_repair_manager_added_products.sql)
- [supabase/migrations/0006_inventory_resume_workflow.sql](../../supabase/migrations/0006_inventory_resume_workflow.sql)
- [supabase/migrations/0007_remove_deleted_products_from_drafts.sql](../../supabase/migrations/0007_remove_deleted_products_from_drafts.sql)
- [supabase/migrations/0008_admin_task_reads.sql](../../supabase/migrations/0008_admin_task_reads.sql)
- [supabase/migrations/0009_multi_store_accounts.sql](../../supabase/migrations/0009_multi_store_accounts.sql)
- [supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- [supabase/migrations/0011_save_arrival_draft.sql](../../supabase/migrations/0011_save_arrival_draft.sql)
- [supabase/migrations/0012_arrival_report_returning_rls.sql](../../supabase/migrations/0012_arrival_report_returning_rls.sql)
- [supabase/migrations/0013_v2_task_templates.sql](../../supabase/migrations/0013_v2_task_templates.sql)
- [supabase/migrations/0014_v2_task_template_privileges.sql](../../supabase/migrations/0014_v2_task_template_privileges.sql)
- [supabase/migrations/0015_v2_task_template_archive_audit.sql](../../supabase/migrations/0015_v2_task_template_archive_audit.sql)
- [supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql)
- [supabase/migrations/0017_v2_task_submission_validation.sql](../../supabase/migrations/0017_v2_task_submission_validation.sql)
- [supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql](../../supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql)
- [supabase/migrations/0019_v2_task_schedule_helper_privileges.sql](../../supabase/migrations/0019_v2_task_schedule_helper_privileges.sql)
- [supabase/migrations/0020_v2_recurring_task_schedules.sql](../../supabase/migrations/0020_v2_recurring_task_schedules.sql)
- [supabase/migrations/0021_admin_operation_overview.sql](../../supabase/migrations/0021_admin_operation_overview.sql)
- [supabase/migrations/0022_v2_monthly_task_schedules.sql](../../supabase/migrations/0022_v2_monthly_task_schedules.sql)
- [supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql)
- [supabase/migrations/0024_v2_sop_task_template_link.sql](../../supabase/migrations/0024_v2_sop_task_template_link.sql)
- [supabase/migrations/0025_v2_analytics_history.sql](../../supabase/migrations/0025_v2_analytics_history.sql)
- [supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql)
- [supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql)
- [supabase/migrations/0028_sync_paused_task_schedule_visibility.sql](../../supabase/migrations/0028_sync_paused_task_schedule_visibility.sql)
- [supabase/migrations/0029_clear_admin_test_todos.sql](../../supabase/migrations/0029_clear_admin_test_todos.sql)
- [supabase/migrations/0030_content_delete_and_analytics_range.sql](../../supabase/migrations/0030_content_delete_and_analytics_range.sql)
- [supabase/migrations/0031_notice_asset_admin_delete.sql](../../supabase/migrations/0031_notice_asset_admin_delete.sql)
- [supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql](../../supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql)
- [supabase/migrations/0033_v2_task_template_reference_images.sql](../../supabase/migrations/0033_v2_task_template_reference_images.sql)
- [supabase/migrations/0034_v2_task_template_archive_delete.sql](../../supabase/migrations/0034_v2_task_template_archive_delete.sql)
- [supabase/migrations/0035_v2_task_reference_images_and_withdraw.sql](../../supabase/migrations/0035_v2_task_reference_images_and_withdraw.sql)
- [supabase/migrations/0036_v2_task_submission_image_requirements.sql](../../supabase/migrations/0036_v2_task_submission_image_requirements.sql)
- [supabase/migrations/0037_v2_task_reference_image_direct_upload.sql](../../supabase/migrations/0037_v2_task_reference_image_direct_upload.sql)
- [supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql](../../supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql)
- [supabase/migrations/0039_sop_categories_and_steps.sql](../../supabase/migrations/0039_sop_categories_and_steps.sql)
- [supabase/migrations/0040_sop_category_delete.sql](../../supabase/migrations/0040_sop_category_delete.sql)
- [supabase/migrations/0041_sop_step_reordering.sql](../../supabase/migrations/0041_sop_step_reordering.sql)
- [supabase/migrations/0042_sop_product_cover_images.sql](../../supabase/migrations/0042_sop_product_cover_images.sql)
- [supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql](../../supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql)
- [supabase/migrations/0044_rename_sop_category.sql](../../supabase/migrations/0044_rename_sop_category.sql)
- [supabase/migrations/0045_notice_and_task_template_lifecycle.sql](../../supabase/migrations/0045_notice_and_task_template_lifecycle.sql)
- [supabase/migrations/0046_v2_task_item_review.sql](../../supabase/migrations/0046_v2_task_item_review.sql)
- [supabase/migrations/0047_sop_optional_step_image_or_text.sql](../../supabase/migrations/0047_sop_optional_step_image_or_text.sql)
- [supabase/migrations/0048_unarchive_v2_sop.sql](../../supabase/migrations/0048_unarchive_v2_sop.sql)
- [supabase/migrations/0049_system_user_manuals.sql](../../supabase/migrations/0049_system_user_manuals.sql)
- [supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql)
- [supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql](../../supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql)
- [supabase/migrations/0052_dingtalk_attendance_cron_transport.sql](../../supabase/migrations/0052_dingtalk_attendance_cron_transport.sql)
- [supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql)
- [supabase/migrations/0054_v2_task_individual_assignment.sql](../../supabase/migrations/0054_v2_task_individual_assignment.sql)
- [supabase/migrations/0055_attendance_day_and_conflict_corrections.sql](../../supabase/migrations/0055_attendance_day_and_conflict_corrections.sql)
- [supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql)
- [supabase/migrations/0057_sop_favorites.sql](../../supabase/migrations/0057_sop_favorites.sql)
- [supabase/migrations/0058_attendance_admin_conflict_rollup.sql](../../supabase/migrations/0058_attendance_admin_conflict_rollup.sql)
- [supabase/migrations/0059_sop_lightweight_card_paging.sql](../../supabase/migrations/0059_sop_lightweight_card_paging.sql)
- [supabase/migrations/0060_sop_progressive_detail.sql](../../supabase/migrations/0060_sop_progressive_detail.sql)
- [supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql](../../supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql)
- [supabase/migrations/0062_realtime_payroll_estimates.sql](../../supabase/migrations/0062_realtime_payroll_estimates.sql)
- [supabase/migrations/0063_payroll_china_date_boundary.sql](../../supabase/migrations/0063_payroll_china_date_boundary.sql)
- [supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql)
- [supabase/migrations/0065_fix_payroll_evidence_storage_access.sql](../../supabase/migrations/0065_fix_payroll_evidence_storage_access.sql)
- [supabase/migrations/0066_backfill_default_overtime_rate.sql](../../supabase/migrations/0066_backfill_default_overtime_rate.sql)
- [supabase/migrations/0067_overtime_revision_and_role_approval.sql](../../supabase/migrations/0067_overtime_revision_and_role_approval.sql)
- [supabase/migrations/0068_pos_sales_revenue_sync.sql](../../supabase/migrations/0068_pos_sales_revenue_sync.sql)
- [supabase/migrations/0069_pos_sales_sync_timeout.sql](../../supabase/migrations/0069_pos_sales_sync_timeout.sql)
- [supabase/migrations/0070_monthly_revenue_sources.sql](../../supabase/migrations/0070_monthly_revenue_sources.sql)
- [supabase/migrations/0071_full_attendance_bonus.sql](../../supabase/migrations/0071_full_attendance_bonus.sql)
- [supabase/migrations/0072_payroll_revenue_carry_forward.sql](../../supabase/migrations/0072_payroll_revenue_carry_forward.sql)
- [supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql)
- [supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- [supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql)
- [supabase/migrations/0076_withdraw_recurring_task_schedule.sql](../../supabase/migrations/0076_withdraw_recurring_task_schedule.sql)
- [supabase/migrations/0077_full_published_task_editing.sql](../../supabase/migrations/0077_full_published_task_editing.sql)
- [supabase/migrations/0078_payroll_payslips.sql](../../supabase/migrations/0078_payroll_payslips.sql)
- [supabase/migrations/0079_payroll_payslip_draft_workflow.sql](../../supabase/migrations/0079_payroll_payslip_draft_workflow.sql)
- [supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql](../../supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql)
- [supabase/migrations/0081_payroll_issue_normalization.sql](../../supabase/migrations/0081_payroll_issue_normalization.sql)
- [supabase/migrations/0082_payroll_historical_employee_scope.sql](../../supabase/migrations/0082_payroll_historical_employee_scope.sql)
- [supabase/migrations/0083_payroll_function_volatility.sql](../../supabase/migrations/0083_payroll_function_volatility.sql)
- [supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql](../../supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql)
- [supabase/migrations/0085_part_time_employment_and_payroll.sql](../../supabase/migrations/0085_part_time_employment_and_payroll.sql)
- [supabase/migrations/0086_part_time_payroll_history_scope.sql](../../supabase/migrations/0086_part_time_payroll_history_scope.sql)
- [supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql](../../supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql)
- [supabase/migrations/0088_admin_controlled_payslip_schedule.sql](../../supabase/migrations/0088_admin_controlled_payslip_schedule.sql)
- [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql)
- [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql)
- [supabase/migrations/0091_operation_reports.sql](../../supabase/migrations/0091_operation_reports.sql)
- [supabase/migrations/0092_operation_report_image_cleanup.sql](../../supabase/migrations/0092_operation_report_image_cleanup.sql)
- [supabase/migrations/0093_system_operation_logs.sql](../../supabase/migrations/0093_system_operation_logs.sql)
- [supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql)
- [supabase/migrations/0095_operation_report_retry_window.sql](../../supabase/migrations/0095_operation_report_retry_window.sql)
- [supabase/migrations/0096_disable_attendance_sync_queues.sql](../../supabase/migrations/0096_disable_attendance_sync_queues.sql)
- [supabase/migrations/0097_incremental_attendance_sync.sql](../../supabase/migrations/0097_incremental_attendance_sync.sql)
- [supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql](../../supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql)
- [supabase/migrations/0099_manual_attendance_sync_and_admin_overtime.sql](../../supabase/migrations/0099_manual_attendance_sync_and_admin_overtime.sql)
- [supabase/migrations/0100_unify_arrival_admin_visibility.sql](../../supabase/migrations/0100_unify_arrival_admin_visibility.sql)
- [supabase/migrations/0101_safe_release_control.sql](../../supabase/migrations/0101_safe_release_control.sql)
- [supabase/migrations/0102_detailed_access_operation_logs.sql](../../supabase/migrations/0102_detailed_access_operation_logs.sql)
- [supabase/migrations/0103_admin_record_part_time_hours.sql](../../supabase/migrations/0103_admin_record_part_time_hours.sql)
- [supabase/migrations/0104_arrival_item_required_images.sql](../../supabase/migrations/0104_arrival_item_required_images.sql)
- [supabase/migrations/0105_task_minimum_image_count.sql](../../supabase/migrations/0105_task_minimum_image_count.sql)
- [supabase/migrations/0106_delay_first_recurring_task_release.sql](../../supabase/migrations/0106_delay_first_recurring_task_release.sql)
- [supabase/migrations/0107_reopen_voided_arrival_reports.sql](../../supabase/migrations/0107_reopen_voided_arrival_reports.sql)
- [supabase/migrations/0108_tax_accounting.sql](../../supabase/migrations/0108_tax_accounting.sql)
- [supabase/migrations/0109_operation_report_refund_details_and_reasons.sql](../../supabase/migrations/0109_operation_report_refund_details_and_reasons.sql)
- [supabase/migrations/0110_tax_reporting_store_settings.sql](../../supabase/migrations/0110_tax_reporting_store_settings.sql)
- [supabase/migrations/0111_payroll_payslip_batch_actions.sql](../../supabase/migrations/0111_payroll_payslip_batch_actions.sql)
- [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- [supabase/migrations/0113_task_edit_manager_review.sql](../../supabase/migrations/0113_task_edit_manager_review.sql)
- [supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql](../../supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql)
- [supabase/migrations/0115_task_related_content.sql](../../supabase/migrations/0115_task_related_content.sql)
- [supabase/migrations/0116_task_related_content_editing.sql](../../supabase/migrations/0116_task_related_content_editing.sql)
- [supabase/migrations/0117_multi_store_payroll_performance.sql](../../supabase/migrations/0117_multi_store_payroll_performance.sql)
- [supabase/migrations/0118_task_completion_scope_and_arrival_match_status.sql](../../supabase/migrations/0118_task_completion_scope_and_arrival_match_status.sql)
- [supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- [supabase/migrations/0120_refine_existing_product_categories.sql](../../supabase/migrations/0120_refine_existing_product_categories.sql)
- [supabase/migrations/0121_exclude_processed_fruit_products.sql](../../supabase/migrations/0121_exclude_processed_fruit_products.sql)
- [supabase/migrations/0122_recurring_task_completion_mode_editing.sql](../../supabase/migrations/0122_recurring_task_completion_mode_editing.sql)
- [supabase/migrations/0123_multistore_task_execution_access.sql](../../supabase/migrations/0123_multistore_task_execution_access.sql)
- [supabase/migrations/0124_multistore_task_image_storage_access.sql](../../supabase/migrations/0124_multistore_task_image_storage_access.sql)
- [supabase/migrations/0125_atomic_arrival_product_creation.sql](../../supabase/migrations/0125_atomic_arrival_product_creation.sql)
- [supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- [supabase/migrations/0127_repair_hawthorn_sauce_canonical_unit.sql](../../supabase/migrations/0127_repair_hawthorn_sauce_canonical_unit.sql)
- [supabase/migrations/0128_fix_sop_publish_notification_body.sql](../../supabase/migrations/0128_fix_sop_publish_notification_body.sql)
- [supabase/migrations/0129_product_spec_correction_tasks.sql](../../supabase/migrations/0129_product_spec_correction_tasks.sql)
- [supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql](../../supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql)
- [supabase/migrations/0131_operation_log_throttle.sql](../../supabase/migrations/0131_operation_log_throttle.sql)
- [supabase/migrations/0132_fast_admin_arrival_list.sql](../../supabase/migrations/0132_fast_admin_arrival_list.sql)
- [supabase/migrations/0133_repair_wudaokou_inventory_template_store.sql](../../supabase/migrations/0133_repair_wudaokou_inventory_template_store.sql)
- [supabase/migrations/0134_atomic_v2_task_resubmission.sql](../../supabase/migrations/0134_atomic_v2_task_resubmission.sql)
- [supabase/migrations/0135_arrival_draft_reset_and_corrections.sql](../../supabase/migrations/0135_arrival_draft_reset_and_corrections.sql)
- [supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql](../../supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql)
- [supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql)
- [supabase/migrations/0138_skip_unchanged_tax_sync.sql](../../supabase/migrations/0138_skip_unchanged_tax_sync.sql)
- [supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql](../../supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql)
- [supabase/migrations/0140_payroll_cross_store_work_allocation.sql](../../supabase/migrations/0140_payroll_cross_store_work_allocation.sql)
- [supabase/migrations/0141_configurable_fieldwork_payroll_allocation.sql](../../supabase/migrations/0141_configurable_fieldwork_payroll_allocation.sql)
- [supabase/migrations/0142_payroll_other_deductions_and_admin_confirmation_todos.sql](../../supabase/migrations/0142_payroll_other_deductions_and_admin_confirmation_todos.sql)
- [supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- [supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- [supabase/migrations/0145_ai_review_security_hardening.sql](../../supabase/migrations/0145_ai_review_security_hardening.sql)
- [supabase/migrations/0146_fix_ai_pilot_uuid_allowlist.sql](../../supabase/migrations/0146_fix_ai_pilot_uuid_allowlist.sql)
- [supabase/migrations/0147_admin_ai_review_hardening_replay.sql](../../supabase/migrations/0147_admin_ai_review_hardening_replay.sql)
- [supabase/migrations/0148_ai_pilot_cost_guard.sql](../../supabase/migrations/0148_ai_pilot_cost_guard.sql)
- [supabase/migrations/0149_ai_pilot_quota_exemption.sql](../../supabase/migrations/0149_ai_pilot_quota_exemption.sql)
- [supabase/migrations/0150_arrival_product_match_and_unit.sql](../../supabase/migrations/0150_arrival_product_match_and_unit.sql)
- [supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql](../../supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql)
- [supabase/migrations/0152_ai_auto_toggle_hard_stop.sql](../../supabase/migrations/0152_ai_auto_toggle_hard_stop.sql)
- [supabase/migrations/0153_ai_provider_agnostic_config.sql](../../supabase/migrations/0153_ai_provider_agnostic_config.sql)
- [supabase/migrations/0154_ai_auto_toggle_stop_enqueue.sql](../../supabase/migrations/0154_ai_auto_toggle_stop_enqueue.sql)
- [supabase/migrations/0155_manager_create_payroll_penalty.sql](../../supabase/migrations/0155_manager_create_payroll_penalty.sql)
- [supabase/migrations/0156_manager_penalty_evidence_insert.sql](../../supabase/migrations/0156_manager_penalty_evidence_insert.sql)
- [supabase/migrations/0157_manager_task_publish.sql](../../supabase/migrations/0157_manager_task_publish.sql)
- [supabase/migrations/0158_remove_ai_background_queue.sql](../../supabase/migrations/0158_remove_ai_background_queue.sql)
- [supabase/migrations/0159_manager_penalty_read.sql](../../supabase/migrations/0159_manager_penalty_read.sql)
- [supabase/migrations/0160_role_notification_read_access.sql](../../supabase/migrations/0160_role_notification_read_access.sql)
- [supabase/migrations/0161_zero_amount_payroll_penalty_details.sql](../../supabase/migrations/0161_zero_amount_payroll_penalty_details.sql)
- [supabase/migrations/0162_operation_log_active_profile_filter.sql](../../supabase/migrations/0162_operation_log_active_profile_filter.sql)
- [supabase/migrations/0163_publishable_task_template_list.sql](../../supabase/migrations/0163_publishable_task_template_list.sql)
- [supabase/migrations/0164_task_template_rename.sql](../../supabase/migrations/0164_task_template_rename.sql)
- [supabase/migrations/0165_employee_information_management.sql](../../supabase/migrations/0165_employee_information_management.sql)
- [supabase/migrations/0166_product_archive_requests_and_log_pagination.sql](../../supabase/migrations/0166_product_archive_requests_and_log_pagination.sql)
- [supabase/migrations/0167_reactivate_archived_products_on_arrival.sql](../../supabase/migrations/0167_reactivate_archived_products_on_arrival.sql)
- [supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql](../../supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql)
- [supabase/migrations/0169_linked_inventory_partial_recount.sql](../../supabase/migrations/0169_linked_inventory_partial_recount.sql)
- [supabase/migrations/0170_arrival_product_search.sql](../../supabase/migrations/0170_arrival_product_search.sql)
- [supabase/migrations/0171_task_batch_review_and_work_terms.sql](../../supabase/migrations/0171_task_batch_review_and_work_terms.sql)
- [supabase/migrations/0172_xizhimen_product_registrations.sql](../../supabase/migrations/0172_xizhimen_product_registrations.sql)
- [supabase/migrations/0173_product_registration_quantity.sql](../../supabase/migrations/0173_product_registration_quantity.sql)
- [supabase/migrations/0174_payroll_holiday_subsidy.sql](../../supabase/migrations/0174_payroll_holiday_subsidy.sql)
- [supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql](../../supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql)
- [supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql)
- [supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql](../../supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql)
- [supabase/migrations/0178_configurable_attendance_award_thresholds.sql](../../supabase/migrations/0178_configurable_attendance_award_thresholds.sql)
- [supabase/migrations/0179_operation_log_visibility_and_attribution.sql](../../supabase/migrations/0179_operation_log_visibility_and_attribution.sql)
- [supabase/migrations/0180_individual_activity_events.sql](../../supabase/migrations/0180_individual_activity_events.sql)
- [supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- [supabase/migrations/0182_closed_store_business_entry_guards.sql](../../supabase/migrations/0182_closed_store_business_entry_guards.sql)
- [supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- [supabase/migrations/0184_skip_zero_payroll_payslips.sql](../../supabase/migrations/0184_skip_zero_payroll_payslips.sql)
- [supabase/migrations/0185_employee_default_performance_grade.sql](../../supabase/migrations/0185_employee_default_performance_grade.sql)
- [supabase/migrations/0186_penalty_image_employee_access.sql](../../supabase/migrations/0186_penalty_image_employee_access.sql)
- [supabase/migrations/0187_inactive_penalty_history_read.sql](../../supabase/migrations/0187_inactive_penalty_history_read.sql)
- [supabase/migrations/0188_server_task_batch_review.sql](../../supabase/migrations/0188_server_task_batch_review.sql)

## SQL 函数定义历史定位

按函数名静态索引 CREATE/REPLACE 所在文件；含重载、包装与后续 rename/drop，最后列出的文件不一定是最终有效函数体。编辑前结合全部迁移和真实数据库确认。

- `private.ai_assert_current_source`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_auto_enqueue_entity`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_build_context`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_claim_one`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_context_hash`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_enqueue_review`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql) → [supabase/migrations/0145_ai_review_security_hardening.sql](../../supabase/migrations/0145_ai_review_security_hardening.sql) → [supabase/migrations/0147_admin_ai_review_hardening_replay.sql](../../supabase/migrations/0147_admin_ai_review_hardening_replay.sql) → [supabase/migrations/0149_ai_pilot_quota_exemption.sql](../../supabase/migrations/0149_ai_pilot_quota_exemption.sql) → [supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql](../../supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql) → [supabase/migrations/0154_ai_auto_toggle_stop_enqueue.sql](../../supabase/migrations/0154_ai_auto_toggle_stop_enqueue.sql)
- `private.ai_product_catalog`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_provider_model_allowed`：[supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql](../../supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql)
- `private.ai_sync_named_pilot_store`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `private.ai_validate_suggestion_draft_patch`：[supabase/migrations/0145_ai_review_security_hardening.sql](../../supabase/migrations/0145_ai_review_security_hardening.sql) → [supabase/migrations/0147_admin_ai_review_hardening_replay.sql](../../supabase/migrations/0147_admin_ai_review_hardening_replay.sql)
- `private.attach_payroll_holiday_metadata`：[supabase/migrations/0174_payroll_holiday_subsidy.sql](../../supabase/migrations/0174_payroll_holiday_subsidy.sql) → [supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- `private.dispatch_ai_review_queue`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql) → [supabase/migrations/0152_ai_auto_toggle_hard_stop.sql](../../supabase/migrations/0152_ai_auto_toggle_hard_stop.sql)
- `private.dispatch_attendance_automation`：[supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql) → [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql) → [supabase/migrations/0096_disable_attendance_sync_queues.sql](../../supabase/migrations/0096_disable_attendance_sync_queues.sql) → [supabase/migrations/0097_incremental_attendance_sync.sql](../../supabase/migrations/0097_incremental_attendance_sync.sql)
- `private.dispatch_pos_sales_automation`：[supabase/migrations/0068_pos_sales_revenue_sync.sql](../../supabase/migrations/0068_pos_sales_revenue_sync.sql) → [supabase/migrations/0069_pos_sales_sync_timeout.sql](../../supabase/migrations/0069_pos_sales_sync_timeout.sql)
- `private.dispatch_qmai_sales_automation`：[supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql](../../supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql)
- `private.normalize_payroll_custom_items`：[supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- `private.payroll_default_performance_grade`：[supabase/migrations/0185_employee_default_performance_grade.sql](../../supabase/migrations/0185_employee_default_performance_grade.sql)
- `private.payroll_holiday_work_dates`：[supabase/migrations/0174_payroll_holiday_subsidy.sql](../../supabase/migrations/0174_payroll_holiday_subsidy.sql) → [supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- `private.payroll_snapshot_is_zero`：[supabase/migrations/0184_skip_zero_payroll_payslips.sql](../../supabase/migrations/0184_skip_zero_payroll_payslips.sql)
- `public.acknowledge_v2_notice`：[supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql)
- `public.admin_ai_act_on_suggestion`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_ai_backfill_pilot`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_ai_check_product_draft`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_ai_get_review`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_ai_list_reviews`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_ai_skip_review`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_attendance_month`：[supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql) → [supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql](../../supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql) → [supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql) → [supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql) → [supabase/migrations/0058_attendance_admin_conflict_rollup.sql](../../supabase/migrations/0058_attendance_admin_conflict_rollup.sql) → [supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql](../../supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql)
- `public.admin_bind_dingtalk_employee`：[supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql) → [supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql)
- `public.admin_create_payroll_penalty`：[supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql)
- `public.admin_create_recommended_products`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.admin_delete_operation_report_refund_reason`：[supabase/migrations/0109_operation_report_refund_details_and_reasons.sql](../../supabase/migrations/0109_operation_report_refund_details_and_reasons.sql)
- `public.admin_end_profile_store`：[supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql](../../supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql)
- `public.admin_ensure_ai_review`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_generate_payroll_payslips`：[supabase/migrations/0079_payroll_payslip_draft_workflow.sql](../../supabase/migrations/0079_payroll_payslip_draft_workflow.sql) → [supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql)
- `public.admin_get_ai_provider_config`：[supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql](../../supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql) → [supabase/migrations/0153_ai_provider_agnostic_config.sql](../../supabase/migrations/0153_ai_provider_agnostic_config.sql)
- `public.admin_get_ai_settings`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_get_payroll_individual_tax_override`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.admin_handle_product_feedback`：[supabase/migrations/0002_manager_product_workflow.sql](../../supabase/migrations/0002_manager_product_workflow.sql) → [supabase/migrations/0166_product_archive_requests_and_log_pagination.sql](../../supabase/migrations/0166_product_archive_requests_and_log_pagination.sql)
- `public.admin_issue_payroll_payslips`：[supabase/migrations/0078_payroll_payslips.sql](../../supabase/migrations/0078_payroll_payslips.sql)
- `public.admin_operation_overview`：[supabase/migrations/0021_admin_operation_overview.sql](../../supabase/migrations/0021_admin_operation_overview.sql) → [supabase/migrations/0100_unify_arrival_admin_visibility.sql](../../supabase/migrations/0100_unify_arrival_admin_visibility.sql)
- `public.admin_payroll_estimates`：[supabase/migrations/0062_realtime_payroll_estimates.sql](../../supabase/migrations/0062_realtime_payroll_estimates.sql) → [supabase/migrations/0063_payroll_china_date_boundary.sql](../../supabase/migrations/0063_payroll_china_date_boundary.sql) → [supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql) → [supabase/migrations/0082_payroll_historical_employee_scope.sql](../../supabase/migrations/0082_payroll_historical_employee_scope.sql) → [supabase/migrations/0085_part_time_employment_and_payroll.sql](../../supabase/migrations/0085_part_time_employment_and_payroll.sql) → [supabase/migrations/0086_part_time_payroll_history_scope.sql](../../supabase/migrations/0086_part_time_payroll_history_scope.sql)
- `public.admin_payroll_statistics_inputs`：[supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql) → [supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql](../../supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql) → [supabase/migrations/0140_payroll_cross_store_work_allocation.sql](../../supabase/migrations/0140_payroll_cross_store_work_allocation.sql) → [supabase/migrations/0141_configurable_fieldwork_payroll_allocation.sql](../../supabase/migrations/0141_configurable_fieldwork_payroll_allocation.sql) → [supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql) → [supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.admin_record_payroll_overtime`：[supabase/migrations/0099_manual_attendance_sync_and_admin_overtime.sql](../../supabase/migrations/0099_manual_attendance_sync_and_admin_overtime.sql) → [supabase/migrations/0103_admin_record_part_time_hours.sql](../../supabase/migrations/0103_admin_record_part_time_hours.sql) → [supabase/migrations/0171_task_batch_review_and_work_terms.sql](../../supabase/migrations/0171_task_batch_review_and_work_terms.sql)
- `public.admin_remove_dingtalk_store_enterprise`：[supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql)
- `public.admin_rerun_ai_review`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_save_ai_provider_config`：[supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql](../../supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql) → [supabase/migrations/0153_ai_provider_agnostic_config.sql](../../supabase/migrations/0153_ai_provider_agnostic_config.sql)
- `public.admin_save_ai_settings`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_save_ai_store_scope`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.admin_save_attendance_automation_settings`：[supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql) → [supabase/migrations/0096_disable_attendance_sync_queues.sql](../../supabase/migrations/0096_disable_attendance_sync_queues.sql)
- `public.admin_save_attendance_incremental_schedule`：[supabase/migrations/0097_incremental_attendance_sync.sql](../../supabase/migrations/0097_incremental_attendance_sync.sql)
- `public.admin_save_dingtalk_store_enterprise`：[supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql) → [supabase/migrations/0055_attendance_day_and_conflict_corrections.sql](../../supabase/migrations/0055_attendance_day_and_conflict_corrections.sql)
- `public.admin_save_operation_report_template`：[supabase/migrations/0091_operation_reports.sql](../../supabase/migrations/0091_operation_reports.sql)
- `public.admin_save_payroll_attendance_allocation_rule`：[supabase/migrations/0141_configurable_fieldwork_payroll_allocation.sql](../../supabase/migrations/0141_configurable_fieldwork_payroll_allocation.sql)
- `public.admin_save_payroll_custom_items`：[supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- `public.admin_save_payroll_employee_rule`：[supabase/migrations/0062_realtime_payroll_estimates.sql](../../supabase/migrations/0062_realtime_payroll_estimates.sql) → [supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql) → [supabase/migrations/0071_full_attendance_bonus.sql](../../supabase/migrations/0071_full_attendance_bonus.sql) → [supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql) → [supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql](../../supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql) → [supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql](../../supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql) → [supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql](../../supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql) → [supabase/migrations/0178_configurable_attendance_award_thresholds.sql](../../supabase/migrations/0178_configurable_attendance_award_thresholds.sql)
- `public.admin_save_payroll_employee_rule_v2`：[supabase/migrations/0117_multi_store_payroll_performance.sql](../../supabase/migrations/0117_multi_store_payroll_performance.sql) → [supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql](../../supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql)
- `public.admin_save_payroll_individual_tax_override`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql) → [supabase/migrations/0138_skip_unchanged_tax_sync.sql](../../supabase/migrations/0138_skip_unchanged_tax_sync.sql)
- `public.admin_save_payroll_individual_taxes`：[supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql)
- `public.admin_save_payroll_monthly_performance`：[supabase/migrations/0117_multi_store_payroll_performance.sql](../../supabase/migrations/0117_multi_store_payroll_performance.sql) → [supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql)
- `public.admin_save_payroll_overtime_rate`：[supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql)
- `public.admin_save_payroll_payslip_schedule_settings`：[supabase/migrations/0088_admin_controlled_payslip_schedule.sql](../../supabase/migrations/0088_admin_controlled_payslip_schedule.sql)
- `public.admin_save_payroll_performance_override`：[supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql](../../supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql)
- `public.admin_save_payroll_performance_rule`：[supabase/migrations/0062_realtime_payroll_estimates.sql](../../supabase/migrations/0062_realtime_payroll_estimates.sql)
- `public.admin_save_payroll_visibility_settings`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.admin_save_product_matching_settings`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.admin_send_payroll_payslip`：[supabase/migrations/0079_payroll_payslip_draft_workflow.sql](../../supabase/migrations/0079_payroll_payslip_draft_workflow.sql)
- `public.admin_send_payroll_payslip_to_manager`：[supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.admin_send_payroll_payslips`：[supabase/migrations/0111_payroll_payslip_batch_actions.sql](../../supabase/migrations/0111_payroll_payslip_batch_actions.sql)
- `public.admin_set_dingtalk_api_daily_limit`：[supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql](../../supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql)
- `public.admin_set_product_permissions`：[supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql)
- `public.admin_set_profile_stores`：[supabase/migrations/0009_multi_store_accounts.sql](../../supabase/migrations/0009_multi_store_accounts.sql) → [supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql](../../supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql)
- `public.admin_set_store_operating`：[supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.admin_unbind_dingtalk_employee`：[supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql) → [supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql)
- `public.admin_update_arrival_report`：[supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql](../../supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql)
- `public.admin_update_operation_report_refund_reason`：[supabase/migrations/0109_operation_report_refund_details_and_reasons.sql](../../supabase/migrations/0109_operation_report_refund_details_and_reasons.sql)
- `public.admin_update_payroll_payslip`：[supabase/migrations/0079_payroll_payslip_draft_workflow.sql](../../supabase/migrations/0079_payroll_payslip_draft_workflow.sql) → [supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql](../../supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql) → [supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql](../../supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql) → [supabase/migrations/0174_payroll_holiday_subsidy.sql](../../supabase/migrations/0174_payroll_holiday_subsidy.sql) → [supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- `public.admin_v2_analytics`：[supabase/migrations/0025_v2_analytics_history.sql](../../supabase/migrations/0025_v2_analytics_history.sql) → [supabase/migrations/0030_content_delete_and_analytics_range.sql](../../supabase/migrations/0030_content_delete_and_analytics_range.sql)
- `public.admin_withdraw_payroll_payslip`：[supabase/migrations/0079_payroll_payslip_draft_workflow.sql](../../supabase/migrations/0079_payroll_payslip_draft_workflow.sql)
- `public.admin_withdraw_payroll_payslips`：[supabase/migrations/0111_payroll_payslip_batch_actions.sql](../../supabase/migrations/0111_payroll_payslip_batch_actions.sql)
- `public.ai_review_is_enabled`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.apply_due_profile_store_assignments`：[supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql](../../supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql)
- `public.apply_v2_task_content`：[supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql) → [supabase/migrations/0077_full_published_task_editing.sql](../../supabase/migrations/0077_full_published_task_editing.sql)
- `public.archive_v2_notice`：[supabase/migrations/0045_notice_and_task_template_lifecycle.sql](../../supabase/migrations/0045_notice_and_task_template_lifecycle.sql)
- `public.archive_v2_sop`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql](../../supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql) → [supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql](../../supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql)
- `public.archive_v2_task_template`：[supabase/migrations/0013_v2_task_templates.sql](../../supabase/migrations/0013_v2_task_templates.sql) → [supabase/migrations/0015_v2_task_template_archive_audit.sql](../../supabase/migrations/0015_v2_task_template_archive_audit.sql) → [supabase/migrations/0045_notice_and_task_template_lifecycle.sql](../../supabase/migrations/0045_notice_and_task_template_lifecycle.sql)
- `public.assert_supported_client_release`：[supabase/migrations/0101_safe_release_control.sql](../../supabase/migrations/0101_safe_release_control.sql)
- `public.attach_v2_task_template_reference_image`：[supabase/migrations/0037_v2_task_reference_image_direct_upload.sql](../../supabase/migrations/0037_v2_task_reference_image_direct_upload.sql)
- `public.begin_operation_report_refresh`：[supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql)
- `public.bind_qmai_sales_integration`：[supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql](../../supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql)
- `public.calculate_payroll_estimate_before_award_separation`：[supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql) → [supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.calculate_payroll_estimate_before_departure_month`：[supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql](../../supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql) → [supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.calculate_payroll_estimate_before_estimated_individual_tax`：[supabase/migrations/0117_multi_store_payroll_performance.sql](../../supabase/migrations/0117_multi_store_payroll_performance.sql) → [supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql](../../supabase/migrations/0139_departure_months_and_manual_statistics_revenue.sql) → [supabase/migrations/0174_payroll_holiday_subsidy.sql](../../supabase/migrations/0174_payroll_holiday_subsidy.sql) → [supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql) → [supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql](../../supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql) → [supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql](../../supabase/migrations/0183_payroll_attendance_subsidy_and_custom_items.sql)
- `public.calculate_payroll_estimate_before_holiday_subsidy`：[supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql](../../supabase/migrations/0177_preserve_holiday_subsidy_with_dated_performance.sql)
- `public.calculate_payroll_estimate_internal`：[supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql](../../supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql)
- `public.can_admin_access_ai_store`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.can_admin_manage_attendance_profile`：[supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql) → [supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql](../../supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql) → [supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql) → [supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql](../../supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql)
- `public.can_admin_read_attendance_store`：[supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql)
- `public.can_edit_arrival_report`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.can_edit_v2_task`：[supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql) → [supabase/migrations/0054_v2_task_individual_assignment.sql](../../supabase/migrations/0054_v2_task_individual_assignment.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0123_multistore_task_execution_access.sql](../../supabase/migrations/0123_multistore_task_execution_access.sql) → [supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql](../../supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql)
- `public.can_edit_v2_task_item`：[supabase/migrations/0046_v2_task_item_review.sql](../../supabase/migrations/0046_v2_task_item_review.sql)
- `public.can_manage_store`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql) → [supabase/migrations/0009_multi_store_accounts.sql](../../supabase/migrations/0009_multi_store_accounts.sql)
- `public.can_manage_v2_notice`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql)
- `public.can_manage_v2_sop`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql)
- `public.can_manage_v2_task_content_asset`：[supabase/migrations/0077_full_published_task_editing.sql](../../supabase/migrations/0077_full_published_task_editing.sql)
- `public.can_manage_v2_task_template`：[supabase/migrations/0013_v2_task_templates.sql](../../supabase/migrations/0013_v2_task_templates.sql) → [supabase/migrations/0157_manager_task_publish.sql](../../supabase/migrations/0157_manager_task_publish.sql)
- `public.can_modify_task`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- `public.can_operate_arrival_modules`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.can_read_arrival_image_object`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.can_read_arrival_report`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.can_read_payroll_evidence`：[supabase/migrations/0065_fix_payroll_evidence_storage_access.sql](../../supabase/migrations/0065_fix_payroll_evidence_storage_access.sql)
- `public.can_read_v2_notice`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql) → [supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql)
- `public.can_read_v2_sop`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql)
- `public.can_read_v2_task`：[supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql) → [supabase/migrations/0054_v2_task_individual_assignment.sql](../../supabase/migrations/0054_v2_task_individual_assignment.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql](../../supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql) → [supabase/migrations/0123_multistore_task_execution_access.sql](../../supabase/migrations/0123_multistore_task_execution_access.sql)
- `public.can_request_product_feedback`：[supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql) → [supabase/migrations/0166_product_archive_requests_and_log_pagination.sql](../../supabase/migrations/0166_product_archive_requests_and_log_pagination.sql)
- `public.can_review_v2_task`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql](../../supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql)
- `public.can_upload_v2_task_image_path`：[supabase/migrations/0124_multistore_task_image_storage_access.sql](../../supabase/migrations/0124_multistore_task_image_storage_access.sql)
- `public.can_view_task`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- `public.can_view_v2_task_template`：[supabase/migrations/0013_v2_task_templates.sql](../../supabase/migrations/0013_v2_task_templates.sql) → [supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql](../../supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql)
- `public.can_write_arrival_image_object`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.capture_profile_store_access_added`：[supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql](../../supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql)
- `public.capture_system_operation_log`：[supabase/migrations/0093_system_operation_logs.sql](../../supabase/migrations/0093_system_operation_logs.sql) → [supabase/migrations/0102_detailed_access_operation_logs.sql](../../supabase/migrations/0102_detailed_access_operation_logs.sql) → [supabase/migrations/0179_operation_log_visibility_and_attribution.sql](../../supabase/migrations/0179_operation_log_visibility_and_attribution.sql)
- `public.claim_ai_review_jobs`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql) → [supabase/migrations/0152_ai_auto_toggle_hard_stop.sql](../../supabase/migrations/0152_ai_auto_toggle_hard_stop.sql)
- `public.claim_ai_review_run`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql) → [supabase/migrations/0152_ai_auto_toggle_hard_stop.sql](../../supabase/migrations/0152_ai_auto_toggle_hard_stop.sql)
- `public.claim_attendance_history_sync_job`：[supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql)
- `public.complete_ai_review_run`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.complete_attendance_missing_punch_todo`：[supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql)
- `public.configure_ai_review_automation`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.configure_attendance_automation`：[supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql) → [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql)
- `public.configure_pos_sales_integration`：[supabase/migrations/0068_pos_sales_revenue_sync.sql](../../supabase/migrations/0068_pos_sales_revenue_sync.sql)
- `public.configure_qmai_sales_integration`：[supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql](../../supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql)
- `public.configure_system_release_policy`：[supabase/migrations/0101_safe_release_control.sql](../../supabase/migrations/0101_safe_release_control.sql)
- `public.configure_v2_tasks_inventory`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.confirm_delegated_payroll_payslip`：[supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.confirm_my_payroll_payslip`：[supabase/migrations/0078_payroll_payslips.sql](../../supabase/migrations/0078_payroll_payslips.sql) → [supabase/migrations/0142_payroll_other_deductions_and_admin_confirmation_todos.sql](../../supabase/migrations/0142_payroll_other_deductions_and_admin_confirmation_todos.sql) → [supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.create_admin_payroll_confirmation_todos`：[supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.create_linked_inventory_task`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql) → [supabase/migrations/0169_linked_inventory_partial_recount.sql](../../supabase/migrations/0169_linked_inventory_partial_recount.sql)
- `public.create_v2_sop_text_step`：[supabase/migrations/0047_sop_optional_step_image_or_text.sql](../../supabase/migrations/0047_sop_optional_step_image_or_text.sql)
- `public.create_v2_task_category`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.create_v2_task_from_schedule`：[supabase/migrations/0020_v2_recurring_task_schedules.sql](../../supabase/migrations/0020_v2_recurring_task_schedules.sql) → [supabase/migrations/0028_sync_paused_task_schedule_visibility.sql](../../supabase/migrations/0028_sync_paused_task_schedule_visibility.sql) → [supabase/migrations/0054_v2_task_individual_assignment.sql](../../supabase/migrations/0054_v2_task_individual_assignment.sql) → [supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0115_task_related_content.sql](../../supabase/migrations/0115_task_related_content.sql) → [supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.create_v2_task_schedule`：[supabase/migrations/0020_v2_recurring_task_schedules.sql](../../supabase/migrations/0020_v2_recurring_task_schedules.sql) → [supabase/migrations/0022_v2_monthly_task_schedules.sql](../../supabase/migrations/0022_v2_monthly_task_schedules.sql) → [supabase/migrations/0054_v2_task_individual_assignment.sql](../../supabase/migrations/0054_v2_task_individual_assignment.sql)
- `public.create_v2_task_schedule_v2`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql) → [supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql) → [supabase/migrations/0106_delay_first_recurring_task_release.sql](../../supabase/migrations/0106_delay_first_recurring_task_release.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.create_v2_task_schedule_v3`：[supabase/migrations/0115_task_related_content.sql](../../supabase/migrations/0115_task_related_content.sql)
- `public.create_v2_task_schedule_v4`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.create_v2_task_schedule_v5`：[supabase/migrations/0122_recurring_task_completion_mode_editing.sql](../../supabase/migrations/0122_recurring_task_completion_mode_editing.sql)
- `public.current_user_role`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- `public.current_user_store_id`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- `public.delete_archived_v2_sop`：[supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql](../../supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql)
- `public.delete_archived_v2_task_template`：[supabase/migrations/0034_v2_task_template_archive_delete.sql](../../supabase/migrations/0034_v2_task_template_archive_delete.sql)
- `public.delete_v2_notice`：[supabase/migrations/0030_content_delete_and_analytics_range.sql](../../supabase/migrations/0030_content_delete_and_analytics_range.sql) → [supabase/migrations/0045_notice_and_task_template_lifecycle.sql](../../supabase/migrations/0045_notice_and_task_template_lifecycle.sql)
- `public.delete_v2_sop_category`：[supabase/migrations/0040_sop_category_delete.sql](../../supabase/migrations/0040_sop_category_delete.sql)
- `public.delete_v2_task_category`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.dispatch_scheduled_v2_task_publications`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.dispatch_v2_task_schedules`：[supabase/migrations/0020_v2_recurring_task_schedules.sql](../../supabase/migrations/0020_v2_recurring_task_schedules.sql) → [supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql](../../supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql)
- `public.enforce_complete_attendance_day`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.enforce_supported_client_release`：[supabase/migrations/0101_safe_release_control.sql](../../supabase/migrations/0101_safe_release_control.sql)
- `public.expire_payroll_confirmation_todos`：[supabase/migrations/0142_payroll_other_deductions_and_admin_confirmation_todos.sql](../../supabase/migrations/0142_payroll_other_deductions_and_admin_confirmation_todos.sql)
- `public.fail_ai_review_run`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.generate_arrival_report_no`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.generate_arrival_summary`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.get_attendance_automation_settings`：[supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql)
- `public.get_attendance_incremental_schedule`：[supabase/migrations/0097_incremental_attendance_sync.sql](../../supabase/migrations/0097_incremental_attendance_sync.sql)
- `public.get_attendance_month_detail`：[supabase/migrations/0050_dingtalk_attendance.sql](../../supabase/migrations/0050_dingtalk_attendance.sql) → [supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql](../../supabase/migrations/0051_dingtalk_attendance_scope_hardening.sql) → [supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql](../../supabase/migrations/0053_dingtalk_multi_enterprise_attendance.sql) → [supabase/migrations/0055_attendance_day_and_conflict_corrections.sql](../../supabase/migrations/0055_attendance_day_and_conflict_corrections.sql) → [supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql) → [supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql](../../supabase/migrations/0061_sop_copy_and_attendance_scope_rollup.sql)
- `public.get_dingtalk_api_usage`：[supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql) → [supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql](../../supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql)
- `public.get_operation_report_availability`：[supabase/migrations/0091_operation_reports.sql](../../supabase/migrations/0091_operation_reports.sql) → [supabase/migrations/0109_operation_report_refund_details_and_reasons.sql](../../supabase/migrations/0109_operation_report_refund_details_and_reasons.sql)
- `public.get_payroll_deduction_items`：[supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql](../../supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql) → [supabase/migrations/0161_zero_amount_payroll_penalty_details.sql](../../supabase/migrations/0161_zero_amount_payroll_penalty_details.sql)
- `public.get_payroll_estimate`：[supabase/migrations/0062_realtime_payroll_estimates.sql](../../supabase/migrations/0062_realtime_payroll_estimates.sql) → [supabase/migrations/0063_payroll_china_date_boundary.sql](../../supabase/migrations/0063_payroll_china_date_boundary.sql) → [supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql) → [supabase/migrations/0070_monthly_revenue_sources.sql](../../supabase/migrations/0070_monthly_revenue_sources.sql) → [supabase/migrations/0071_full_attendance_bonus.sql](../../supabase/migrations/0071_full_attendance_bonus.sql) → [supabase/migrations/0072_payroll_revenue_carry_forward.sql](../../supabase/migrations/0072_payroll_revenue_carry_forward.sql) → [supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql) → [supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql) → [supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql](../../supabase/migrations/0080_payroll_extra_awards_and_history_fix.sql) → [supabase/migrations/0081_payroll_issue_normalization.sql](../../supabase/migrations/0081_payroll_issue_normalization.sql) → [supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql](../../supabase/migrations/0084_payroll_tax_performance_override_and_deductions.sql) → [supabase/migrations/0085_part_time_employment_and_payroll.sql](../../supabase/migrations/0085_part_time_employment_and_payroll.sql) → [supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql](../../supabase/migrations/0087_part_time_estimate_and_monthly_performance_score.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.get_payroll_payslip_schedule_settings`：[supabase/migrations/0088_admin_controlled_payslip_schedule.sql](../../supabase/migrations/0088_admin_controlled_payslip_schedule.sql)
- `public.get_payroll_visibility_settings`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.get_product_matching_settings`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.get_system_release_policy`：[supabase/migrations/0101_safe_release_control.sql](../../supabase/migrations/0101_safe_release_control.sql)
- `public.get_v2_sop_detail`：[supabase/migrations/0060_sop_progressive_detail.sql](../../supabase/migrations/0060_sop_progressive_detail.sql)
- `public.get_v2_task_schedule_content`：[supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql)
- `public.guard_closed_store_revenue_input`：[supabase/migrations/0182_closed_store_business_entry_guards.sql](../../supabase/migrations/0182_closed_store_business_entry_guards.sql)
- `public.guard_closed_store_sales_sync`：[supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.has_store_access`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql) → [supabase/migrations/0009_multi_store_accounts.sql](../../supabase/migrations/0009_multi_store_accounts.sql)
- `public.import_inventory_task`：[supabase/migrations/0006_inventory_resume_workflow.sql](../../supabase/migrations/0006_inventory_resume_workflow.sql)
- `public.infer_product_category`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql) → [supabase/migrations/0120_refine_existing_product_categories.sql](../../supabase/migrations/0120_refine_existing_product_categories.sql) → [supabase/migrations/0121_exclude_processed_fruit_products.sql](../../supabase/migrations/0121_exclude_processed_fruit_products.sql)
- `public.issue_payroll_payslips_internal`：[supabase/migrations/0078_payroll_payslips.sql](../../supabase/migrations/0078_payroll_payslips.sql) → [supabase/migrations/0079_payroll_payslip_draft_workflow.sql](../../supabase/migrations/0079_payroll_payslip_draft_workflow.sql) → [supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql)
- `public.issue_scheduled_payroll_payslips`：[supabase/migrations/0078_payroll_payslips.sql](../../supabase/migrations/0078_payroll_payslips.sql) → [supabase/migrations/0088_admin_controlled_payslip_schedule.sql](../../supabase/migrations/0088_admin_controlled_payslip_schedule.sql)
- `public.list_admin_arrivals_v1`：[supabase/migrations/0132_fast_admin_arrival_list.sql](../../supabase/migrations/0132_fast_admin_arrival_list.sql)
- `public.list_admin_arrivals_v2`：[supabase/migrations/0170_arrival_product_search.sql](../../supabase/migrations/0170_arrival_product_search.sql)
- `public.list_admin_products_with_last_inventory`：[supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql](../../supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql)
- `public.list_available_payroll_confirmation_managers`：[supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.list_publishable_v2_task_templates`：[supabase/migrations/0163_publishable_task_template_list.sql](../../supabase/migrations/0163_publishable_task_template_list.sql)
- `public.list_recommended_product_additions`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.list_store_inventory_templates`：[supabase/migrations/0006_inventory_resume_workflow.sql](../../supabase/migrations/0006_inventory_resume_workflow.sql)
- `public.list_system_operation_log_actors`：[supabase/migrations/0102_detailed_access_operation_logs.sql](../../supabase/migrations/0102_detailed_access_operation_logs.sql) → [supabase/migrations/0162_operation_log_active_profile_filter.sql](../../supabase/migrations/0162_operation_log_active_profile_filter.sql)
- `public.list_v2_sop_cards`：[supabase/migrations/0059_sop_lightweight_card_paging.sql](../../supabase/migrations/0059_sop_lightweight_card_paging.sql)
- `public.manager_add_product_from_task`：[supabase/migrations/0004_manager_add_product_workflow.sql](../../supabase/migrations/0004_manager_add_product_workflow.sql)
- `public.manager_create_payroll_penalty`：[supabase/migrations/0155_manager_create_payroll_penalty.sql](../../supabase/migrations/0155_manager_create_payroll_penalty.sql)
- `public.manager_publish_v2_tasks`：[supabase/migrations/0157_manager_task_publish.sql](../../supabase/migrations/0157_manager_task_publish.sql)
- `public.manager_request_product_archive`：[supabase/migrations/0166_product_archive_requests_and_log_pagination.sql](../../supabase/migrations/0166_product_archive_requests_and_log_pagination.sql)
- `public.manager_request_product_deletion`：[supabase/migrations/0002_manager_product_workflow.sql](../../supabase/migrations/0002_manager_product_workflow.sql) → [supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql](../../supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql) → [supabase/migrations/0166_product_archive_requests_and_log_pagination.sql](../../supabase/migrations/0166_product_archive_requests_and_log_pagination.sql)
- `public.manager_save_v2_task_template`：[supabase/migrations/0157_manager_task_publish.sql](../../supabase/migrations/0157_manager_task_publish.sql)
- `public.manager_update_product_from_task`：[supabase/migrations/0002_manager_product_workflow.sql](../../supabase/migrations/0002_manager_product_workflow.sql) → [supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql](../../supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql)
- `public.mark_arrival_viewed`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.mark_v2_notice_read`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql)
- `public.match_recent_arrival_items_for_product`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.match_recent_arrivals_after_product_change`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.next_v2_task_template_due`：[supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql](../../supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql)
- `public.normalize_payroll_confirmation_assignment`：[supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.normalize_product_name`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.notify_other_v2_task_recipients_after_manager_rejection`：[supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql](../../supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql)
- `public.notify_payroll_overtime_reviewers`：[supabase/migrations/0067_overtime_revision_and_role_approval.sql](../../supabase/migrations/0067_overtime_revision_and_role_approval.sql) → [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql) → [supabase/migrations/0171_task_batch_review_and_work_terms.sql](../../supabase/migrations/0171_task_batch_review_and_work_terms.sql)
- `public.notify_v2_task_publication`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql](../../supabase/migrations/0114_manager_task_todos_and_reliable_scheduled_dispatch.sql)
- `public.pause_v2_task_schedule`：[supabase/migrations/0020_v2_recurring_task_schedules.sql](../../supabase/migrations/0020_v2_recurring_task_schedules.sql) → [supabase/migrations/0028_sync_paused_task_schedule_visibility.sql](../../supabase/migrations/0028_sync_paused_task_schedule_visibility.sql)
- `public.payroll_cumulative_tax_liability`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.payroll_membership_store`：[supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql)
- `public.payroll_overtime_todo_count`：[supabase/migrations/0067_overtime_revision_and_role_approval.sql](../../supabase/migrations/0067_overtime_revision_and_role_approval.sql)
- `public.payroll_performance_store_scope`：[supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql) → [supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.payroll_primary_store_on`：[supabase/migrations/0176_dated_payroll_store_scope.sql](../../supabase/migrations/0176_dated_payroll_store_scope.sql)
- `public.payroll_resolve_attendance_store`：[supabase/migrations/0140_payroll_cross_store_work_allocation.sql](../../supabase/migrations/0140_payroll_cross_store_work_allocation.sql)
- `public.payroll_snapshot_with_registered_tax`：[supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql)
- `public.payroll_work_term`：[supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql) → [supabase/migrations/0171_task_batch_review_and_work_terms.sql](../../supabase/migrations/0171_task_batch_review_and_work_terms.sql)
- `public.prepare_operation_report`：[supabase/migrations/0091_operation_reports.sql](../../supabase/migrations/0091_operation_reports.sql) → [supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql) → [supabase/migrations/0097_incremental_attendance_sync.sql](../../supabase/migrations/0097_incremental_attendance_sync.sql) → [supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql](../../supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql) → [supabase/migrations/0109_operation_report_refund_details_and_reasons.sql](../../supabase/migrations/0109_operation_report_refund_details_and_reasons.sql)
- `public.profile_store_ids_on`：[supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql](../../supabase/migrations/0175_effective_store_assignments_and_sync_coverage.sql)
- `public.publish_product_correction_tasks`：[supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql](../../supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql)
- `public.publish_v2_notice`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql) → [supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql](../../supabase/migrations/0032_unified_product_permissions_and_notice_republish.sql) → [supabase/migrations/0045_notice_and_task_template_lifecycle.sql](../../supabase/migrations/0045_notice_and_task_template_lifecycle.sql)
- `public.publish_v2_sop`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql) → [supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql](../../supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql) → [supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql](../../supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql)
- `public.publish_v2_sop_with_options`：[supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql](../../supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql) → [supabase/migrations/0047_sop_optional_step_image_or_text.sql](../../supabase/migrations/0047_sop_optional_step_image_or_text.sql) → [supabase/migrations/0128_fix_sop_publish_notification_body.sql](../../supabase/migrations/0128_fix_sop_publish_notification_body.sql)
- `public.publish_v2_task_template`：[supabase/migrations/0013_v2_task_templates.sql](../../supabase/migrations/0013_v2_task_templates.sql) → [supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql](../../supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql)
- `public.publish_v2_tasks`：[supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql) → [supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql](../../supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql) → [supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql) → [supabase/migrations/0054_v2_task_individual_assignment.sql](../../supabase/migrations/0054_v2_task_individual_assignment.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql)
- `public.publish_v2_tasks_v2`：[supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.publish_v2_tasks_v3`：[supabase/migrations/0115_task_related_content.sql](../../supabase/migrations/0115_task_related_content.sql)
- `public.publish_v2_tasks_v4`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.reconcile_payroll_confirmation_notification`：[supabase/migrations/0143_payroll_manager_confirmation.sql](../../supabase/migrations/0143_payroll_manager_confirmation.sql)
- `public.record_system_activity`：[supabase/migrations/0102_detailed_access_operation_logs.sql](../../supabase/migrations/0102_detailed_access_operation_logs.sql) → [supabase/migrations/0131_operation_log_throttle.sql](../../supabase/migrations/0131_operation_log_throttle.sql) → [supabase/migrations/0179_operation_log_visibility_and_attribution.sql](../../supabase/migrations/0179_operation_log_visibility_and_attribution.sql) → [supabase/migrations/0180_individual_activity_events.sql](../../supabase/migrations/0180_individual_activity_events.sql)
- `public.release_operation_report_refresh`：[supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql) → [supabase/migrations/0095_operation_report_retry_window.sql](../../supabase/migrations/0095_operation_report_retry_window.sql)
- `public.rename_v2_sop_category`：[supabase/migrations/0044_rename_sop_category.sql](../../supabase/migrations/0044_rename_sop_category.sql)
- `public.rename_v2_task_template`：[supabase/migrations/0164_task_template_rename.sql](../../supabase/migrations/0164_task_template_rename.sql)
- `public.reopen_voided_arrival_report`：[supabase/migrations/0107_reopen_voided_arrival_reports.sql](../../supabase/migrations/0107_reopen_voided_arrival_reports.sql)
- `public.reorder_v2_sop_assets`：[supabase/migrations/0041_sop_step_reordering.sql](../../supabase/migrations/0041_sop_step_reordering.sql) → [supabase/migrations/0042_sop_product_cover_images.sql](../../supabase/migrations/0042_sop_product_cover_images.sql)
- `public.replace_pos_sales_day`：[supabase/migrations/0068_pos_sales_revenue_sync.sql](../../supabase/migrations/0068_pos_sales_revenue_sync.sql)
- `public.replace_pos_sales_range`：[supabase/migrations/0070_monthly_revenue_sources.sql](../../supabase/migrations/0070_monthly_revenue_sources.sql)
- `public.replace_qmai_sales_range`：[supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql](../../supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql)
- `public.request_arrival_product_creation`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql) → [supabase/migrations/0125_atomic_arrival_product_creation.sql](../../supabase/migrations/0125_atomic_arrival_product_creation.sql) → [supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.require_inventory_before_v2_task_submission`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql) → [supabase/migrations/0169_linked_inventory_partial_recount.sql](../../supabase/migrations/0169_linked_inventory_partial_recount.sql)
- `public.reserve_dingtalk_api_call`：[supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql) → [supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql](../../supabase/migrations/0098_attendance_recheck_quota_and_report_schedule.sql)
- `public.reset_arrival_draft`：[supabase/migrations/0135_arrival_draft_reset_and_corrections.sql](../../supabase/migrations/0135_arrival_draft_reset_and_corrections.sql)
- `public.resume_v2_task_schedule`：[supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql) → [supabase/migrations/0028_sync_paused_task_schedule_visibility.sql](../../supabase/migrations/0028_sync_paused_task_schedule_visibility.sql) → [supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.retract_v2_notice`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql)
- `public.retract_v2_sop`：[supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql](../../supabase/migrations/0043_sop_lifecycle_and_silent_publish.sql)
- `public.retract_v2_task_template`：[supabase/migrations/0045_notice_and_task_template_lifecycle.sql](../../supabase/migrations/0045_notice_and_task_template_lifecycle.sql)
- `public.review_arrival_correction_request`：[supabase/migrations/0135_arrival_draft_reset_and_corrections.sql](../../supabase/migrations/0135_arrival_draft_reset_and_corrections.sql)
- `public.review_payroll_overtime_request`：[supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql) → [supabase/migrations/0067_overtime_revision_and_role_approval.sql](../../supabase/migrations/0067_overtime_revision_and_role_approval.sql) → [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql) → [supabase/migrations/0171_task_batch_review_and_work_terms.sql](../../supabase/migrations/0171_task_batch_review_and_work_terms.sql)
- `public.review_product_creation_request`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.review_product_creation_request_v2`：[supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql](../../supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql)
- `public.review_v2_task`：[supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql) → [supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql) → [supabase/migrations/0046_v2_task_item_review.sql](../../supabase/migrations/0046_v2_task_item_review.sql)
- `public.review_v2_task_items`：[supabase/migrations/0046_v2_task_item_review.sql](../../supabase/migrations/0046_v2_task_item_review.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql) → [supabase/migrations/0129_product_spec_correction_tasks.sql](../../supabase/migrations/0129_product_spec_correction_tasks.sql) → [supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql](../../supabase/migrations/0130_product_management_sort_review_and_correction_tasks.sql)
- `public.review_v2_task_items_with_inventory`：[supabase/migrations/0169_linked_inventory_partial_recount.sql](../../supabase/migrations/0169_linked_inventory_partial_recount.sql)
- `public.review_v2_tasks_batch`：[supabase/migrations/0188_server_task_batch_review.sql](../../supabase/migrations/0188_server_task_batch_review.sql)
- `public.save_arrival_draft`：[supabase/migrations/0011_save_arrival_draft.sql](../../supabase/migrations/0011_save_arrival_draft.sql)
- `public.save_operation_report_draft`：[supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql](../../supabase/migrations/0094_operation_report_drafts_and_dingtalk_quota.sql)
- `public.save_operation_report_refund_reason`：[supabase/migrations/0109_operation_report_refund_details_and_reasons.sql](../../supabase/migrations/0109_operation_report_refund_details_and_reasons.sql)
- `public.save_payroll_store_revenue_input`：[supabase/migrations/0070_monthly_revenue_sources.sql](../../supabase/migrations/0070_monthly_revenue_sources.sql)
- `public.save_v2_notice`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0026_navigation_notifications_permissions.sql](../../supabase/migrations/0026_navigation_notifications_permissions.sql) → [supabase/migrations/0027_notice_assets_expiry_and_notifications.sql](../../supabase/migrations/0027_notice_assets_expiry_and_notifications.sql)
- `public.save_v2_sop`：[supabase/migrations/0023_v2_notices_and_sops.sql](../../supabase/migrations/0023_v2_notices_and_sops.sql) → [supabase/migrations/0024_v2_sop_task_template_link.sql](../../supabase/migrations/0024_v2_sop_task_template_link.sql) → [supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql](../../supabase/migrations/0038_fix_v2_sop_lifecycle_constraints.sql)
- `public.save_v2_task_progress`：[supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql) → [supabase/migrations/0046_v2_task_item_review.sql](../../supabase/migrations/0046_v2_task_item_review.sql)
- `public.save_v2_task_template`：[supabase/migrations/0013_v2_task_templates.sql](../../supabase/migrations/0013_v2_task_templates.sql) → [supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql](../../supabase/migrations/0018_v2_task_visibility_schedule_and_images.sql) → [supabase/migrations/0033_v2_task_template_reference_images.sql](../../supabase/migrations/0033_v2_task_template_reference_images.sql) → [supabase/migrations/0035_v2_task_reference_images_and_withdraw.sql](../../supabase/migrations/0035_v2_task_reference_images_and_withdraw.sql) → [supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.service_get_ai_provider_config`：[supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql](../../supabase/migrations/0151_ai_provider_config_and_auto_toggle.sql) → [supabase/migrations/0153_ai_provider_agnostic_config.sql](../../supabase/migrations/0153_ai_provider_agnostic_config.sql)
- `public.set_arrival_report_snapshots`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql) → [supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql](../../supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql)
- `public.set_inventory_task_categories`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.set_v2_task_template_minimum_image_counts`：[supabase/migrations/0105_task_minimum_image_count.sql](../../supabase/migrations/0105_task_minimum_image_count.sql)
- `public.store_has_operating_days`：[supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.store_is_operating_on`：[supabase/migrations/0181_store_business_closures.sql](../../supabase/migrations/0181_store_business_closures.sql)
- `public.submit_arrival_correction_request`：[supabase/migrations/0135_arrival_draft_reset_and_corrections.sql](../../supabase/migrations/0135_arrival_draft_reset_and_corrections.sql)
- `public.submit_arrival_report`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql) → [supabase/migrations/0104_arrival_item_required_images.sql](../../supabase/migrations/0104_arrival_item_required_images.sql)
- `public.submit_arrival_report_with_product_requests`：[supabase/migrations/0125_atomic_arrival_product_creation.sql](../../supabase/migrations/0125_atomic_arrival_product_creation.sql) → [supabase/migrations/0150_arrival_product_match_and_unit.sql](../../supabase/migrations/0150_arrival_product_match_and_unit.sql) → [supabase/migrations/0167_reactivate_archived_products_on_arrival.sql](../../supabase/migrations/0167_reactivate_archived_products_on_arrival.sql)
- `public.submit_operation_report`：[supabase/migrations/0091_operation_reports.sql](../../supabase/migrations/0091_operation_reports.sql)
- `public.submit_payroll_overtime_request`：[supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql](../../supabase/migrations/0064_overtime_penalty_evidence_and_notifications.sql) → [supabase/migrations/0067_overtime_revision_and_role_approval.sql](../../supabase/migrations/0067_overtime_revision_and_role_approval.sql) → [supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql) → [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql)
- `public.submit_v2_task`：[supabase/migrations/0016_v2_task_execution.sql](../../supabase/migrations/0016_v2_task_execution.sql) → [supabase/migrations/0017_v2_task_submission_validation.sql](../../supabase/migrations/0017_v2_task_submission_validation.sql) → [supabase/migrations/0036_v2_task_submission_image_requirements.sql](../../supabase/migrations/0036_v2_task_submission_image_requirements.sql) → [supabase/migrations/0046_v2_task_item_review.sql](../../supabase/migrations/0046_v2_task_item_review.sql) → [supabase/migrations/0105_task_minimum_image_count.sql](../../supabase/migrations/0105_task_minimum_image_count.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.submit_v2_task_with_answers`：[supabase/migrations/0134_atomic_v2_task_resubmission.sql](../../supabase/migrations/0134_atomic_v2_task_resubmission.sql)
- `public.suppress_self_v2_task_rejection_notification`：[supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql](../../supabase/migrations/0136_arrival_multistore_admin_edit_and_rejection_handoff.sql)
- `public.switch_current_store`：[supabase/migrations/0009_multi_store_accounts.sql](../../supabase/migrations/0009_multi_store_accounts.sql)
- `public.sync_attendance_missing_punch_todo`：[supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql)
- `public.sync_product_deletion_feedback_state`：[supabase/migrations/0006_inventory_resume_workflow.sql](../../supabase/migrations/0006_inventory_resume_workflow.sql) → [supabase/migrations/0166_product_archive_requests_and_log_pagination.sql](../../supabase/migrations/0166_product_archive_requests_and_log_pagination.sql)
- `public.sync_product_registration_entry_from_fields`：[supabase/migrations/0172_xizhimen_product_registrations.sql](../../supabase/migrations/0172_xizhimen_product_registrations.sql)
- `public.sync_product_registration_entry_from_image`：[supabase/migrations/0172_xizhimen_product_registrations.sql](../../supabase/migrations/0172_xizhimen_product_registrations.sql)
- `public.sync_product_registration_entry_status`：[supabase/migrations/0172_xizhimen_product_registrations.sql](../../supabase/migrations/0172_xizhimen_product_registrations.sql) → [supabase/migrations/0173_product_registration_quantity.sql](../../supabase/migrations/0173_product_registration_quantity.sql)
- `public.sync_registered_tax_to_payroll_payslip`：[supabase/migrations/0137_payroll_tax_registration.sql](../../supabase/migrations/0137_payroll_tax_registration.sql)
- `public.sync_tax_reporting_person_from_profile`：[supabase/migrations/0165_employee_information_management.sql](../../supabase/migrations/0165_employee_information_management.sql)
- `public.touch_arrival_report`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.touch_updated_at`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- `public.unarchive_v2_sop`：[supabase/migrations/0048_unarchive_v2_sop.sql](../../supabase/migrations/0048_unarchive_v2_sop.sql)
- `public.update_payroll_overtime_request`：[supabase/migrations/0067_overtime_revision_and_role_approval.sql](../../supabase/migrations/0067_overtime_revision_and_role_approval.sql) → [supabase/migrations/0073_payroll_attendance_followups.sql](../../supabase/migrations/0073_payroll_attendance_followups.sql) → [supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql](../../supabase/migrations/0090_attendance_schedule_and_part_time_terms.sql)
- `public.update_product_category`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.update_v2_task_content`：[supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql)
- `public.update_v2_task_content_v2`：[supabase/migrations/0113_task_edit_manager_review.sql](../../supabase/migrations/0113_task_edit_manager_review.sql)
- `public.update_v2_task_content_v3`：[supabase/migrations/0116_task_related_content_editing.sql](../../supabase/migrations/0116_task_related_content_editing.sql)
- `public.update_v2_task_content_v4`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.update_v2_task_recipients`：[supabase/migrations/0118_task_completion_scope_and_arrival_match_status.sql](../../supabase/migrations/0118_task_completion_scope_and_arrival_match_status.sql)
- `public.update_v2_task_schedule_all`：[supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql)
- `public.update_v2_task_schedule_all_v2`：[supabase/migrations/0116_task_related_content_editing.sql](../../supabase/migrations/0116_task_related_content_editing.sql)
- `public.update_v2_task_schedule_all_v3`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.update_v2_task_schedule_all_v4`：[supabase/migrations/0122_recurring_task_completion_mode_editing.sql](../../supabase/migrations/0122_recurring_task_completion_mode_editing.sql)
- `public.update_v2_task_schedule_content`：[supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql) → [supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql)
- `public.update_v2_task_schedule_recipients`：[supabase/migrations/0122_recurring_task_completion_mode_editing.sql](../../supabase/migrations/0122_recurring_task_completion_mode_editing.sql)
- `public.update_v2_task_schedule_v2`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql) → [supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql](../../supabase/migrations/0075_task_content_edit_and_same_day_acceptance.sql) → [supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql](../../supabase/migrations/0112_task_approval_scheduling_and_estimated_tax.sql)
- `public.v2_task_audience_for_profile`：[supabase/migrations/0089_task_recipient_audiences.sql](../../supabase/migrations/0089_task_recipient_audiences.sql)
- `public.v2_task_schedule_acceptance_due`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.v2_task_schedule_first_release`：[supabase/migrations/0106_delay_first_recurring_task_release.sql](../../supabase/migrations/0106_delay_first_recurring_task_release.sql)
- `public.v2_task_schedule_next_due`：[supabase/migrations/0020_v2_recurring_task_schedules.sql](../../supabase/migrations/0020_v2_recurring_task_schedules.sql) → [supabase/migrations/0022_v2_monthly_task_schedules.sql](../../supabase/migrations/0022_v2_monthly_task_schedules.sql) → [supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
- `public.validate_arrival_report_image`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql) → [supabase/migrations/0104_arrival_item_required_images.sql](../../supabase/migrations/0104_arrival_item_required_images.sql)
- `public.validate_arrival_report_item`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.validate_extra_task_item_product_name`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.validate_linked_inventory_submission`：[supabase/migrations/0119_product_categories_inventory_linked_tasks.sql](../../supabase/migrations/0119_product_categories_inventory_linked_tasks.sql)
- `public.validate_task_item_store`：[supabase/migrations/0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql)
- `public.validate_unique_product_name`：[supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql](../../supabase/migrations/0126_product_name_uniqueness_and_recommendations.sql)
- `public.validate_v2_task_related_content`：[supabase/migrations/0115_task_related_content.sql](../../supabase/migrations/0115_task_related_content.sql)
- `public.verify_ai_review_cron_token`：[supabase/migrations/0144_admin_structured_ai_review.sql](../../supabase/migrations/0144_admin_structured_ai_review.sql)
- `public.verify_attendance_cron_token`：[supabase/migrations/0056_attendance_automation_and_detail_flags.sql](../../supabase/migrations/0056_attendance_automation_and_detail_flags.sql)
- `public.verify_pos_sales_cron_token`：[supabase/migrations/0068_pos_sales_revenue_sync.sql](../../supabase/migrations/0068_pos_sales_revenue_sync.sql)
- `public.verify_qmai_sales_cron_token`：[supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql](../../supabase/migrations/0168_qmai_store_binding_and_sales_sync.sql)
- `public.void_arrival_report`：[supabase/migrations/0010_arrival_reports.sql](../../supabase/migrations/0010_arrival_reports.sql)
- `public.withdraw_v2_task`：[supabase/migrations/0035_v2_task_reference_images_and_withdraw.sql](../../supabase/migrations/0035_v2_task_reference_images_and_withdraw.sql)
- `public.withdraw_v2_task_schedule`：[supabase/migrations/0076_withdraw_recurring_task_schedule.sql](../../supabase/migrations/0076_withdraw_recurring_task_schedule.sql)
- `public.withdraw_v2_task_schedule_current`：[supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql](../../supabase/migrations/0074_attendance_payroll_history_and_task_scheduling.sql)
