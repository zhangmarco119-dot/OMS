import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationDirectory = join(root, 'supabase', 'migrations');
const seedPath = join(root, 'supabase', 'seed.sql');
const envExamplePath = join(root, '.env.example');
const arrivalRollbackPath = join(root, 'supabase', 'rollbacks', '0010_arrival_reports.sql');
const arrivalTestPath = join(root, 'supabase', 'tests', '0010_arrival_schema.sql');
const arrivalDraftTestPath = join(root, 'supabase', 'tests', '0011_arrival_draft_rpc.sql');
const arrivalMigrationPath = join(root, 'supabase', 'migrations', '0010_arrival_reports.sql');
const arrivalDraftMigrationPath = join(root, 'supabase', 'migrations', '0011_save_arrival_draft.sql');
const arrivalDraftRollbackPath = join(root, 'supabase', 'rollbacks', '0011_save_arrival_draft.sql');
const arrivalReturningMigrationPath = join(root, 'supabase', 'migrations', '0012_arrival_report_returning_rls.sql');
const arrivalReturningRollbackPath = join(root, 'supabase', 'rollbacks', '0012_arrival_report_returning_rls.sql');
const arrivalReturningTestPath = join(root, 'supabase', 'tests', '0012_arrival_report_returning_rls.sql');
const taskTemplateMigrationPath = join(root, 'supabase', 'migrations', '0013_v2_task_templates.sql');
const taskTemplateRollbackPath = join(root, 'supabase', 'rollbacks', '0013_v2_task_templates.sql');
const taskTemplateTestPath = join(root, 'supabase', 'tests', '0013_v2_task_templates.sql');
const taskTemplatePrivilegeMigrationPath = join(root, 'supabase', 'migrations', '0014_v2_task_template_privileges.sql');
const taskTemplateArchiveAuditMigrationPath = join(root, 'supabase', 'migrations', '0015_v2_task_template_archive_audit.sql');
const taskExecutionTestPath = join(root, 'supabase', 'tests', '0016_v2_task_execution.sql');
const taskVisibilityScheduleMigrationPath = join(root, 'supabase', 'migrations', '0018_v2_task_visibility_schedule_and_images.sql');
const taskVisibilityScheduleTestPath = join(root, 'supabase', 'tests', '0018_v2_task_visibility_schedule_and_images.sql');
const taskSchedulePrivilegeMigrationPath = join(root, 'supabase', 'migrations', '0019_v2_task_schedule_helper_privileges.sql');
const recurringTaskScheduleMigrationPath = join(root, 'supabase', 'migrations', '0020_v2_recurring_task_schedules.sql');
const recurringTaskScheduleTestPath = join(root, 'supabase', 'tests', '0020_v2_recurring_task_schedules.sql');
const adminOperationOverviewMigrationPath = join(root, 'supabase', 'migrations', '0021_admin_operation_overview.sql');
const adminOperationOverviewTestPath = join(root, 'supabase', 'tests', '0021_admin_operation_overview.sql');
const monthlyTaskScheduleMigrationPath = join(root, 'supabase', 'migrations', '0022_v2_monthly_task_schedules.sql');
const monthlyTaskScheduleTestPath = join(root, 'supabase', 'tests', '0022_v2_monthly_task_schedules.sql');
const navigationPermissionsMigrationPath = join(root, 'supabase', 'migrations', '0026_navigation_notifications_permissions.sql');
const noticeAssetsMigrationPath = join(root, 'supabase', 'migrations', '0027_notice_assets_expiry_and_notifications.sql');
const pausedScheduleVisibilityMigrationPath = join(root, 'supabase', 'migrations', '0028_sync_paused_task_schedule_visibility.sql');
const adminTodoCleanupMigrationPath = join(root, 'supabase', 'migrations', '0029_clear_admin_test_todos.sql');
const contentDeleteAnalyticsRangeMigrationPath = join(root, 'supabase', 'migrations', '0030_content_delete_and_analytics_range.sql');
const noticeAssetAdminDeleteMigrationPath = join(root, 'supabase', 'migrations', '0031_notice_asset_admin_delete.sql');
const unifiedProductPermissionsMigrationPath = join(root, 'supabase', 'migrations', '0032_unified_product_permissions_and_notice_republish.sql');

const migration = readdirSync(migrationDirectory)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort()
  .map((fileName) => readFileSync(join(migrationDirectory, fileName), 'utf8'))
  .join('\n');
const seed = readFileSync(seedPath, 'utf8');
const envExample = readFileSync(envExamplePath, 'utf8');
const arrivalRollback = readFileSync(arrivalRollbackPath, 'utf8');
const arrivalTest = readFileSync(arrivalTestPath, 'utf8');
const arrivalDraftTest = readFileSync(arrivalDraftTestPath, 'utf8');
const arrivalMigration = readFileSync(arrivalMigrationPath, 'utf8');
const arrivalDraftMigration = readFileSync(arrivalDraftMigrationPath, 'utf8');
const arrivalDraftRollback = readFileSync(arrivalDraftRollbackPath, 'utf8');
const arrivalReturningMigration = readFileSync(arrivalReturningMigrationPath, 'utf8');
const arrivalReturningRollback = readFileSync(arrivalReturningRollbackPath, 'utf8');
const arrivalReturningTest = readFileSync(arrivalReturningTestPath, 'utf8');
const taskTemplateMigration = readFileSync(taskTemplateMigrationPath, 'utf8');
const taskTemplateRollback = readFileSync(taskTemplateRollbackPath, 'utf8');
const taskTemplateTest = readFileSync(taskTemplateTestPath, 'utf8');
const taskTemplatePrivilegeMigration = readFileSync(taskTemplatePrivilegeMigrationPath, 'utf8');
const taskTemplateArchiveAuditMigration = readFileSync(taskTemplateArchiveAuditMigrationPath, 'utf8');
const taskExecutionTest = readFileSync(taskExecutionTestPath, 'utf8');
const taskVisibilityScheduleMigration = readFileSync(taskVisibilityScheduleMigrationPath, 'utf8');
const taskVisibilityScheduleTest = readFileSync(taskVisibilityScheduleTestPath, 'utf8');
const taskSchedulePrivilegeMigration = readFileSync(taskSchedulePrivilegeMigrationPath, 'utf8');
const recurringTaskScheduleMigration = readFileSync(recurringTaskScheduleMigrationPath, 'utf8');
const recurringTaskScheduleTest = readFileSync(recurringTaskScheduleTestPath, 'utf8');
const adminOperationOverviewMigration = readFileSync(adminOperationOverviewMigrationPath, 'utf8');
const adminOperationOverviewTest = readFileSync(adminOperationOverviewTestPath, 'utf8');
const monthlyTaskScheduleMigration = readFileSync(monthlyTaskScheduleMigrationPath, 'utf8');
const monthlyTaskScheduleTest = readFileSync(monthlyTaskScheduleTestPath, 'utf8');
const navigationPermissionsMigration = readFileSync(navigationPermissionsMigrationPath, 'utf8');
const noticeAssetsMigration = readFileSync(noticeAssetsMigrationPath, 'utf8');
const pausedScheduleVisibilityMigration = readFileSync(pausedScheduleVisibilityMigrationPath, 'utf8');
const adminTodoCleanupMigration = readFileSync(adminTodoCleanupMigrationPath, 'utf8');
const contentDeleteAnalyticsRangeMigration = readFileSync(contentDeleteAnalyticsRangeMigrationPath, 'utf8');
const noticeAssetAdminDeleteMigration = readFileSync(noticeAssetAdminDeleteMigrationPath, 'utf8');
const unifiedProductPermissionsMigration = readFileSync(unifiedProductPermissionsMigrationPath, 'utf8');

const requiredTables = [
  'stores',
  'profiles',
  'profile_store_access',
  'admin_store_access',
  'admin_task_reads',
  'products',
  'tasks',
  'task_items',
  'product_feedback',
  'audit_logs',
  'arrival_reports',
  'arrival_report_items',
  'arrival_report_images',
  'notifications',
  'v2_task_templates',
  'v2_task_template_stores',
  'v2_task_template_groups',
  'v2_task_template_items',
  'v2_task_template_versions',
  'v2_tasks', 'v2_task_answers', 'v2_task_images', 'v2_task_reviews',
  'v2_task_schedules',
  'profile_product_permissions', 'v2_notice_recipients', 'v2_notice_assets',
];

const storeScopedTables = [
  'profiles',
  'products',
  'tasks',
  'task_items',
  'product_feedback',
  'audit_logs',
  'arrival_reports',
  'arrival_report_images',
  'v2_tasks',
  'v2_task_images',
];

const requiredPolicies = [
  'stores_select_accessible',
  'profiles_select_accessible',
  'profiles_update_admin',
  'profile_store_access_select_allowed',
  'admin_task_reads_select_own',
  'admin_task_reads_insert_own',
  'products_select_store',
  'tasks_select_allowed',
  'tasks_insert_own_draft',
  'tasks_update_allowed',
  'task_items_select_allowed',
  'task_items_update_allowed',
  'product_feedback_insert_allowed',
  'products_update_admin',
  'product_feedback_update_admin',
  'products_insert_admin',
  'audit_logs_insert_actor',
  'arrival_reports_select_allowed',
  'arrival_reports_insert_own_draft',
  'arrival_reports_update_own_draft',
  'arrival_reports_delete_own_draft',
  'arrival_report_items_select_allowed',
  'arrival_report_items_insert_own_draft',
  'arrival_report_items_update_own_draft',
  'arrival_report_items_delete_own_draft',
  'arrival_report_images_select_allowed',
  'arrival_report_images_insert_own_draft',
  'arrival_report_images_delete_own_draft',
  'notifications_select_recipient',
  'arrival_images_storage_select',
  'arrival_images_storage_insert',
  'arrival_images_storage_delete',
  'v2_task_templates_select_allowed',
  'v2_task_template_stores_select_allowed',
  'v2_task_template_groups_select_allowed',
  'v2_task_template_items_select_allowed',
  'v2_task_template_versions_select_allowed',
  'v2_tasks_select_allowed', 'v2_task_answers_select_allowed', 'v2_task_images_select_allowed',
  'v2_task_images_insert_allowed', 'v2_task_images_delete_allowed', 'v2_task_reviews_select_allowed',
  'v2_task_storage_select', 'v2_task_storage_insert', 'v2_task_storage_delete',
  'v2_task_schedules_select_allowed',
  'profile_product_permissions_select_own_or_admin', 'v2_notice_recipients_select_self_or_admin',
  'v2_notice_assets_select_allowed', 'v2_notice_assets_insert_admin', 'v2_notice_assets_delete_admin',
];

const requiredFunctions = [
  'has_store_access',
  'can_manage_store',
  'can_view_task',
  'can_modify_task',
  'validate_task_item_store',
  'manager_update_product_from_task',
  'manager_request_product_deletion',
  'admin_handle_product_feedback',
  'manager_add_product_from_task',
  'list_store_inventory_templates',
  'import_inventory_task',
  'switch_current_store',
  'admin_set_profile_stores',
  'generate_arrival_report_no',
  'set_arrival_report_snapshots',
  'validate_arrival_report_item',
  'validate_arrival_report_image',
  'can_operate_arrival_modules',
  'can_read_arrival_report',
  'can_edit_arrival_report',
  'generate_arrival_summary',
  'submit_arrival_report',
  'mark_arrival_viewed',
  'save_arrival_draft',
  'void_arrival_report',
  'can_read_arrival_image_object',
  'can_write_arrival_image_object',
  'can_manage_v2_task_template',
  'can_view_v2_task_template',
  'attach_v2_task_template_reference_image',
  'save_v2_task_template',
  'publish_v2_task_template',
  'archive_v2_task_template',
  'can_read_v2_task', 'can_edit_v2_task', 'publish_v2_tasks', 'save_v2_task_progress', 'submit_v2_task', 'review_v2_task',
  'create_v2_task_schedule', 'dispatch_v2_task_schedules', 'pause_v2_task_schedule',
  'admin_operation_overview',
  'can_request_product_feedback', 'admin_set_product_permissions', 'resume_v2_task_schedule',
  'acknowledge_v2_notice',
  'delete_v2_notice', 'admin_v2_analytics',
];

const failures = [];

for (const table of requiredTables) {
  if (!migration.includes(`create table public.${table}`)) {
    failures.push(`missing table public.${table}`);
  }
  if (!migration.includes(`alter table public.${table} enable row level security`)) {
    failures.push(`missing RLS enable for public.${table}`);
  }
}

for (const table of storeScopedTables) {
  const tableStart = migration.indexOf(`create table public.${table}`);
  const tableEnd = migration.indexOf(');', tableStart);
  const tableSql = tableStart >= 0 && tableEnd >= 0 ? migration.slice(tableStart, tableEnd) : '';
  if (!tableSql.includes('store_id')) {
    failures.push(`missing store_id column for public.${table}`);
  }
}

for (const policy of requiredPolicies) {
  if (!migration.includes(`create policy ${policy}`)) {
    failures.push(`missing policy ${policy}`);
  }
}

for (const fn of requiredFunctions) {
  if (!migration.includes(`function public.${fn}`)) {
    failures.push(`missing function public.${fn}`);
  }
}

if (!migration.includes("role in ('staff', 'manager', 'admin')")) {
  failures.push('missing role check constraint');
}

if (!migration.includes("task_type in ('inventory', 'order')")) {
  failures.push('missing task_type check constraint');
}

if (!migration.includes("status in ('draft', 'review', 'submitted', 'cancelled')")) {
  failures.push('missing task status check constraint');
}

if (!migration.includes("status in ('pending', 'completed', 'no_order_needed')")) {
  failures.push('missing task item status check constraint');
}

if (!migration.includes('task item store_id must match parent task store_id')) {
  failures.push('missing task item store consistency trigger');
}

if (!migration.includes("status in ('open', 'resolved', 'ignored', 'reverted')")) {
  failures.push('missing product feedback reverted status constraint');
}

if (!migration.includes('references public.products(id) on delete set null')) {
  failures.push('missing safe product deletion foreign key behavior');
}

for (const view of ['arrival_daily_detail_view', 'arrival_daily_product_summary_view']) {
  if (!migration.includes(`create view public.${view}`)) {
    failures.push(`missing view public.${view}`);
  }
}

if ((migration.match(/with \(security_invoker = true\)/g) ?? []).length < 2) {
  failures.push('arrival views must use security_invoker');
}

if (!/'arrival-report-images'\s*,\s*'arrival-report-images'\s*,\s*false/.test(migration)) {
  failures.push('missing private arrival-report-images bucket');
}

if (!migration.includes("array['image/jpeg', 'image/png', 'image/webp']")) {
  failures.push('arrival bucket MIME allowlist is missing');
}

const arrivalSecurityDefiners = arrivalMigration.match(/security definer/g) ?? [];
const hardenedArrivalSecurityDefiners = arrivalMigration.match(
  /security definer\s+set search_path = public/g,
) ?? [];
if (arrivalSecurityDefiners.length !== hardenedArrivalSecurityDefiners.length) {
  failures.push('every arrival security definer function must set search_path to public');
}

if (arrivalMigration.includes('on storage.objects for update')) {
  failures.push('arrival Storage must not allow object overwrite updates');
}

if (!arrivalMigration.includes('join public.arrival_report_images image')) {
  failures.push('arrival Storage reads must require matching image metadata');
}

if (!migration.includes('p_expected_version integer') || !migration.includes('p_idempotency_key text')) {
  failures.push('arrival submission concurrency and idempotency arguments are missing');
}

if (!migration.includes("count(*) filter (where image_type = 'waybill')")
  || !migration.includes("count(*) filter (where image_type = 'goods')")) {
  failures.push('arrival submission image requirements are missing');
}

if (!arrivalRollback.includes("arrival-report-images is not empty")) {
  failures.push('arrival rollback must refuse to remove a non-empty image bucket');
}

if (!arrivalRollback.includes('drop table if exists public.arrival_reports')) {
  failures.push('arrival rollback is missing schema cleanup');
}

if (!arrivalTest.includes('StoreHub V2 arrival schema smoke checks passed')) {
  failures.push('arrival SQL catalog smoke test is missing');
}

if (!migration.includes('function public.save_arrival_draft')) {
  failures.push('missing atomic arrival draft save RPC');
}

if (!migration.includes('revoke update, delete on public.arrival_reports from authenticated')
  || !migration.includes('revoke insert, update, delete on public.arrival_report_items from authenticated')) {
  failures.push('arrival draft tables must prevent direct concurrent writes');
}

if (!migration.includes('arrival_reports_one_draft_per_reporter_idx')) {
  failures.push('arrival drafts require a per-store reporter uniqueness index');
}

if (!arrivalDraftTest.includes('StoreHub V2 atomic arrival draft checks passed')) {
  failures.push('atomic arrival draft SQL privilege test is missing');
}

if (!/security definer\s+set search_path = public/.test(arrivalDraftMigration)) {
  failures.push('arrival draft RPC must harden its security definer search_path');
}

if (!arrivalDraftRollback.includes('drop function if exists public.save_arrival_draft')) {
  failures.push('arrival draft RPC rollback is missing');
}

if (arrivalReturningMigration.includes('can_read_arrival_report(id)')
  || !arrivalReturningMigration.includes('has_store_access(store_id)')
  || !arrivalReturningMigration.includes('current_user_store_id()')) {
  failures.push('arrival report select policy must support INSERT RETURNING without a self-lookup');
}

if (!arrivalReturningTest.includes('StoreHub V2 arrival INSERT RETURNING RLS checks passed')) {
  failures.push('arrival INSERT RETURNING RLS SQL test is missing');
}

if (!arrivalReturningRollback.includes('using (public.can_read_arrival_report(id))')) {
  failures.push('arrival INSERT RETURNING RLS rollback is missing');
}

if (!taskTemplateMigration.includes('v2_task_template_versions')
  || !taskTemplateMigration.includes("'version', v_next_version")
  || !taskTemplateMigration.includes("set status = 'published', current_version = v_next_version")) {
  failures.push('V2 task templates require immutable published versions');
}

if (!/security definer\s+set search_path = public/.test(taskTemplateMigration)
  || !taskTemplateMigration.includes('administrator store access required')) {
  failures.push('V2 task template RPC must enforce hardened administrator store access');
}

if (!taskTemplateTest.includes('StoreHub V2 task template schema checks passed')) {
  failures.push('V2 task template database smoke test is missing');
}

if (!taskTemplateRollback.includes('drop table if exists public.v2_task_templates')) {
  failures.push('V2 task template rollback is missing');
}

for (const table of ['v2_task_templates', 'v2_task_template_stores', 'v2_task_template_groups', 'v2_task_template_items', 'v2_task_template_versions']) {
  if (!taskTemplatePrivilegeMigration.includes(`revoke insert, update, delete on public.${table} from authenticated`)) {
    failures.push(`V2 task template table ${table} must block direct writes`);
  }
}

if (!taskTemplateArchiveAuditMigration.includes("'v2_task_template_archived'")) {
  failures.push('V2 task template archive must write an audit log');
}

if (!taskExecutionTest.includes('StoreHub V2 task execution schema checks passed')) {
  failures.push('V2 task execution database smoke test is missing');
}

if (!taskVisibilityScheduleMigration.includes('recurrence_day')
  || !taskVisibilityScheduleMigration.includes('function public.next_v2_task_template_due')) {
  failures.push('V2 recurring task deadline migration is missing');
}

if (!taskVisibilityScheduleMigration.includes('select public.can_manage_v2_task_template(target_template_id)')) {
  failures.push('store users must not be able to read V2 task templates');
}

if (!taskVisibilityScheduleTest.includes('StoreHub V2 task visibility and schedule checks passed')) {
  failures.push('V2 task visibility and schedule SQL smoke test is missing');
}

if (!taskSchedulePrivilegeMigration.includes('revoke all on function public.next_v2_task_template_due(uuid) from authenticated')) {
  failures.push('V2 schedule helper must not be directly callable by authenticated users');
}

if (!recurringTaskScheduleMigration.includes('create extension if not exists pg_cron')
  || !recurringTaskScheduleMigration.includes("storehub-v2-task-schedule-dispatch")) {
  failures.push('V2 recurring task dispatcher migration is missing');
}

if (!recurringTaskScheduleTest.includes('StoreHub V2 recurring task schedule checks passed')) {
  failures.push('V2 recurring task schedule SQL smoke test is missing');
}

if (!adminOperationOverviewMigration.includes('function public.admin_operation_overview')
  || !adminOperationOverviewTest.includes('StoreHub V2 admin operation overview checks passed')) {
  failures.push('V2 admin operation overview RPC is missing');
}

if (!monthlyTaskScheduleMigration.includes("schedule_type in ('interval_days', 'weekly', 'monthly')")
  || !monthlyTaskScheduleTest.includes('StoreHub V2 monthly task schedule checks passed')) {
  failures.push('V2 monthly task schedule support is missing');
}

if (!navigationPermissionsMigration.includes('recipient_ids')
  || !navigationPermissionsMigration.includes("'notice_published'")) {
  failures.push('notice audience tracking and notice notifications are missing');
}

if (!noticeAssetsMigration.includes("'v2-notice-assets'")
  || !noticeAssetsMigration.includes('expires_at')
  || !noticeAssetsMigration.includes('acknowledge_v2_notice')) {
  failures.push('notice asset, expiry, or acknowledgement migration is missing');
}

if (!noticeAssetsMigration.includes("'sop_published'")
  || !noticeAssetsMigration.includes("'v2_task_published'")
  || !noticeAssetsMigration.includes("'v2_task_'||p_action")) {
  failures.push('SOP and task status notifications are missing');
}

if (!pausedScheduleVisibilityMigration.includes("status in ('pending','in_progress','rejected','overdue')")
  || !pausedScheduleVisibilityMigration.includes("status = 'cancelled'")
  || !pausedScheduleVisibilityMigration.includes('replacement_task_id')) {
  failures.push('paused schedule visibility and resume replacement task handling are missing');
}

if (!adminTodoCleanupMigration.includes("status in ('submitted', 'resubmitted')")
  || !adminTodoCleanupMigration.includes("status = 'ignored'")) {
  failures.push('administrator test todo cleanup migration is incomplete');
}

if (!contentDeleteAnalyticsRangeMigration.includes('function public.delete_v2_notice')
  || !contentDeleteAnalyticsRangeMigration.includes("entity_type = 'v2_notice'")) {
  failures.push('notice deletion migration is missing protected notification cleanup');
}

if (!contentDeleteAnalyticsRangeMigration.includes('p_start_date date')
  || !contentDeleteAnalyticsRangeMigration.includes('p_end_date date')
  || !contentDeleteAnalyticsRangeMigration.includes('start date must not be after end date')) {
  failures.push('analytics date-range migration is incomplete');
}

if (!noticeAssetAdminDeleteMigration.includes('can_manage_v2_notice(asset.notice_id)')) {
  failures.push('notice asset deletion must allow every authorized administrator');
}

if (!unifiedProductPermissionsMigration.includes("role in ('staff', 'manager')")
  || !unifiedProductPermissionsMigration.includes("can_request_product_feedback('incorrect')")
  || !unifiedProductPermissionsMigration.includes("can_request_product_feedback('discontinued')")) {
  failures.push('staff and manager product permissions must use the same protected workflow');
}

if (!unifiedProductPermissionsMigration.includes("v_previous_status = 'retracted'")
  || !unifiedProductPermissionsMigration.includes('set first_read_at = null')) {
  failures.push('republished notices must reset recipient read state');
}

if (envExample.toUpperCase().includes('SERVICE_ROLE')) {
  failures.push('.env.example must not mention a service role key');
}

for (const storeName of ['宝珠奶酪（五道口店）', 'OMEGA酸奶（西直门店）']) {
  if (!seed.includes(storeName)) {
    failures.push(`seed missing store ${storeName}`);
  }
}

if (!seed.includes('BZ-WDK-001') || !seed.includes('OMG-XZM-001')) {
  failures.push('seed missing representative products for both stores');
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Supabase schema validation passed: ${requiredTables.length} tables, ${requiredPolicies.length} policies.`);
