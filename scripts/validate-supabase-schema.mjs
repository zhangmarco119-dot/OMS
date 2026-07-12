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
  'save_v2_task_template',
  'publish_v2_task_template',
  'archive_v2_task_template',
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

if (!migration.includes("'arrival-report-images',\n  'arrival-report-images',\n  false")) {
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

if (!taskTemplateMigration.includes('security definer\nset search_path = public')
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
