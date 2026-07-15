import type { SupabaseClient } from '@supabase/supabase-js';

import { emptyAttendanceMonth, type AdminAttendanceRow, type AttendanceDay, type AttendanceMonthDetail, type AttendanceMonthSummary } from '../features/attendance/model';
import type { Database, Json } from '../types/database';

type Client = SupabaseClient<Database>;
type DirectoryRow = Database['public']['Tables']['dingtalk_employee_directory']['Row'];
type BindingRow = Database['public']['Tables']['dingtalk_employee_bindings']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type StoreRow = Database['public']['Tables']['stores']['Row'];
type EnterpriseRow = Database['public']['Tables']['dingtalk_enterprises']['Row'];
type EnterpriseMappingRow = Database['public']['Tables']['dingtalk_store_enterprise_bindings']['Row'];

export interface AttendanceEmployeeBinding {
  binding: BindingRow;
  employee: DirectoryRow | null;
  enterpriseName: string;
  storeName: string;
}

export interface AttendanceBindingCandidate {
  profile: ProfileRow;
  storeName: string;
  bindings: AttendanceEmployeeBinding[];
  suggestedEmployees: DirectoryRow[];
}

export interface AttendanceEnterpriseSetup {
  enterprises: EnterpriseRow[];
  mappings: EnterpriseMappingRow[];
}

export type AttendanceSyncJob = Database['public']['Tables']['attendance_sync_jobs']['Row'] & {
  failures: Database['public']['Tables']['attendance_sync_failures']['Row'][];
};

const objectAt = (value: Json | null | undefined): Record<string, Json | undefined> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const arrayAt = (value: Json | undefined) => Array.isArray(value) ? value : [];
const textAt = (value: Json | undefined, fallback = '') => typeof value === 'string' ? value : fallback;
const numberAt = (value: Json | undefined) => typeof value === 'number' ? value : 0;

const parseSummary = (value: Json | undefined): AttendanceMonthSummary => {
  const source = objectAt(value);
  return {
    attendanceDates: arrayAt(source.attendanceDates).filter((item): item is string => typeof item === 'string'),
    attendanceDays: numberAt(source.attendanceDays), lateCount: numberAt(source.lateCount), lateMinutes: numberAt(source.lateMinutes),
    missingCount: numberAt(source.missingCount), abnormalCount: numberAt(source.abnormalCount),
    lastSyncedAt: typeof source.lastSyncedAt === 'string' ? source.lastSyncedAt : null,
  };
};

export const loadAttendanceMonth = async (client: Client, profileId: string, month: string): Promise<AttendanceMonthDetail> => {
  const { data, error } = await client.rpc('get_attendance_month_detail', { p_profile_id: profileId, p_month: `${month}-01` });
  if (error) throw new Error('暂时无法加载考勤数据，请稍后重试。');
  const root = objectAt(data);
  if (!root.summary) return emptyAttendanceMonth();
  return { summary: parseSummary(root.summary), days: arrayAt(root.days) as unknown as AttendanceDay[] };
};

export const loadAdminAttendanceMonth = async (client: Client, options: { month: string; storeId?: string; search?: string; status?: string; offset?: number }) => {
  const { data, error } = await client.rpc('admin_attendance_month', {
    p_month: `${options.month}-01`, p_store_id: options.storeId || null, p_search: options.search?.trim() ?? '',
    p_status: options.status ?? 'all', p_limit: 50, p_offset: options.offset ?? 0,
  });
  if (error) throw new Error('暂时无法加载门店考勤汇总，请稍后重试。');
  const root = objectAt(data);
  const items = arrayAt(root.items).map((raw): AdminAttendanceRow => {
    const item = objectAt(raw);
    return {
      profileId: textAt(item.profileId), displayName: textAt(item.displayName, '未命名员工'), storeId: textAt(item.storeId), storeName: textAt(item.storeName, '未知门店'),
      bindingStatus: textAt(item.bindingStatus, 'unbound') as AdminAttendanceRow['bindingStatus'], ...parseSummary(item),
    };
  });
  return { items, total: numberAt(root.total) };
};

export const loadAttendanceBindings = async (client: Client): Promise<{ candidates: AttendanceBindingCandidate[]; directory: DirectoryRow[]; setup: AttendanceEnterpriseSetup }> => {
  const [profilesResult, storesResult, bindingsResult, directoryResult, enterprisesResult, mappingsResult] = await Promise.all([
    client.from('profiles').select('*').in('role', ['staff', 'manager']).eq('is_active', true).is('deleted_at', null).order('display_name'),
    client.from('stores').select('*').eq('is_active', true),
    client.from('dingtalk_employee_bindings').select('*').in('binding_status', ['active', 'error']).order('updated_at', { ascending: false }),
    client.from('dingtalk_employee_directory').select('*').eq('is_active', true).order('display_name'),
    client.from('dingtalk_enterprises').select('*').eq('is_active', true).order('display_name'),
    client.from('dingtalk_store_enterprise_bindings').select('*').eq('is_active', true),
  ]);
  const error = profilesResult.error ?? storesResult.error ?? bindingsResult.error ?? directoryResult.error ?? enterprisesResult.error ?? mappingsResult.error;
  if (error) throw new Error('暂时无法加载钉钉员工绑定信息。');
  const directory = directoryResult.data ?? [];
  const employeeById = new Map(directory.map((employee) => [employee.id, employee]));
  const storeById = new Map((storesResult.data ?? []).map((store: StoreRow) => [store.id, store.name]));
  const enterpriseByCorp = new Map((enterprisesResult.data ?? []).map((enterprise) => [enterprise.corp_id, enterprise.display_name]));
  return {
    directory,
    setup: { enterprises: enterprisesResult.data ?? [], mappings: mappingsResult.data ?? [] },
    candidates: (profilesResult.data ?? []).map((profile) => {
      const bindings = (bindingsResult.data ?? []).filter((binding) => binding.profile_id === profile.id).map((binding) => ({
        binding,
        employee: employeeById.get(binding.directory_user_id) ?? null,
        enterpriseName: enterpriseByCorp.get(binding.corp_id) ?? `钉钉企业 ${binding.corp_id.slice(-6)}`,
        storeName: storeById.get(binding.store_id) ?? '未知门店',
      }));
      return {
        profile, bindings, storeName: storeById.get(profile.store_id) ?? '未知门店',
        suggestedEmployees: directory.filter((employee) => employee.display_name.trim() === profile.display_name.trim()),
      };
    }),
  };
};

export const bindAttendanceEmployee = async (client: Client, profileId: string, directoryUserId: string, storeId: string, suggested: boolean) => {
  const { error } = await client.rpc('admin_bind_dingtalk_employee', { p_profile_id: profileId, p_directory_user_id: directoryUserId, p_store_id: storeId, p_match_source: suggested ? 'name_suggestion' : 'manual' });
  if (error) throw new Error(error.message.includes('already') ? '该钉钉账号已经绑定到其他系统账号，请先解除原绑定。' : error.message.includes('map DingTalk') ? '请先在“企业门店”中建立该钉钉企业与门店的对应关系。' : '绑定未完成，请确认员工、企业和门店后重试。');
};

export const unbindAttendanceEmployee = async (client: Client, bindingId: string) => {
  const { error } = await client.rpc('admin_unbind_dingtalk_employee', { p_binding_id: bindingId });
  if (error) throw new Error('解除绑定未完成，请稍后重试。');
};

export const loadAttendanceEnterpriseSetup = async (client: Client): Promise<AttendanceEnterpriseSetup> => {
  const [enterprises, mappings] = await Promise.all([
    client.from('dingtalk_enterprises').select('*').eq('is_active', true).order('display_name'),
    client.from('dingtalk_store_enterprise_bindings').select('*').eq('is_active', true),
  ]);
  if (enterprises.error ?? mappings.error) throw new Error('暂时无法加载企业与门店对应关系。');
  return { enterprises: enterprises.data ?? [], mappings: mappings.data ?? [] };
};

export const saveAttendanceEnterpriseMapping = async (client: Client, corpId: string, displayName: string, storeId: string) => {
  const { error } = await client.rpc('admin_save_dingtalk_store_enterprise', { p_corp_id: corpId, p_display_name: displayName, p_store_id: storeId });
  if (error) throw new Error('企业与门店对应关系未能保存，请稍后重试。');
};

export const removeAttendanceEnterpriseMapping = async (client: Client, mappingId: string) => {
  const { error } = await client.rpc('admin_remove_dingtalk_store_enterprise', { p_mapping_id: mappingId });
  if (error) throw new Error(error.message.includes('unbind employees') ? '该对应关系仍有已绑定员工，请先解除相关员工绑定。' : '企业与门店对应关系未能移除。');
};

export const invokeAttendanceSync = async (client: Client, body: Record<string, unknown>) => {
  const { data, error } = await client.functions.invoke('dingtalk-attendance', { body });
  if (error) throw new Error('同步请求未能完成，请查看同步日志或确认钉钉配置。');
  const response = data as { error?: string; message?: string; status?: string } | null;
  if (response?.error) throw new Error(response.error);
  return response;
};

export const loadAttendanceSyncJobs = async (client: Client): Promise<AttendanceSyncJob[]> => {
  const { data: jobs, error } = await client.from('attendance_sync_jobs').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) throw new Error('暂时无法加载同步日志。');
  if (!jobs?.length) return [];
  const { data: failures, error: failuresError } = await client.from('attendance_sync_failures').select('*').in('sync_job_id', jobs.map((job) => job.id)).order('created_at');
  if (failuresError) throw new Error('暂时无法加载同步失败详情。');
  return jobs.map((job) => ({ ...job, failures: (failures ?? []).filter((failure) => failure.sync_job_id === job.id) }));
};
