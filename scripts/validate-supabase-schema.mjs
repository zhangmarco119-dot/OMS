import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationDirectory = join(root, 'supabase', 'migrations');
const seedPath = join(root, 'supabase', 'seed.sql');
const envExamplePath = join(root, '.env.example');

const migration = readdirSync(migrationDirectory)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort()
  .map((fileName) => readFileSync(join(migrationDirectory, fileName), 'utf8'))
  .join('\n');
const seed = readFileSync(seedPath, 'utf8');
const envExample = readFileSync(envExamplePath, 'utf8');

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
];

const storeScopedTables = [
  'profiles',
  'products',
  'tasks',
  'task_items',
  'product_feedback',
  'audit_logs',
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
