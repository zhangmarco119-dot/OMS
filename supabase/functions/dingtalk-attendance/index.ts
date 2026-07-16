import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';

import { normalizeAttendanceBundle, type AttendanceBindingInput } from './attendance-normalizer.ts';
import { chunk, DingTalkApiError, DingTalkClient } from './dingtalk-client.ts';
import { loadDingTalkEnterpriseConfigs } from './enterprise-config.ts';
import { summarizeAttendanceSync } from './sync-result.ts';

type AttendanceAction =
  | { action: 'refresh-directory'; rootDepartmentIds?: string[] }
  | { action: 'sync'; month?: string; profileId?: string; storeId?: string }
  | { action: 'enqueue-history-sync'; startMonth: string; endMonth: string; storeId?: string }
  | { action: 'scheduled-sync'; mode?: 'hourly' | 'history-queue' | 'daily' | 'month-start' }
  | { action: 'retry-job'; jobId: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-storehub-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const requiredEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};

const optionalEnv = (key: string, fallback = '') => Deno.env.get(key)?.trim() || fallback;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unique = <T>(items: T[]) => [...new Set(items)];
const datePart = (date: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const shiftDate = (date: string, days: number) => new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const monthsBetween = (start: string, end: string) => {
  const result: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const last = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  while (year * 12 + month <= last) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return result;
};

const publicError = (error: unknown) => {
  if (error instanceof DingTalkApiError) {
    if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') return '钉钉服务暂时无法连接，请稍后重试。';
    if (error.code.startsWith('HTTP_') || error.retryable) return '钉钉服务繁忙，本次同步已记录，可稍后重试。';
    return `钉钉接口未能完成请求（${error.code}）。`;
  }
  return '考勤同步暂时无法完成，请查看同步日志。';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const timezone = optionalEnv('DINGTALK_ENTERPRISE_TIMEZONE', 'Asia/Shanghai');
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let payload: AttendanceAction;
  try { payload = await request.json() as AttendanceAction; }
  catch { return json({ error: '请求内容格式不正确。' }, 400); }

  const cronSecret = optionalEnv('DINGTALK_CRON_SECRET');
  const isScheduled = payload.action === 'scheduled-sync';
  const suppliedCronSecret = request.headers.get('x-storehub-cron-secret') ?? '';
  let actorId: string | null = null;
  let allowedStoreIds: string[] = [];

  if (isScheduled) {
    let authenticated = false;
    if (cronSecret && suppliedCronSecret.length === cronSecret.length) {
      const left = new TextEncoder().encode(suppliedCronSecret);
      const right = new TextEncoder().encode(cronSecret);
      let difference = 0;
      left.forEach((value, index) => { difference |= value ^ right[index]; });
      authenticated = difference === 0;
    }
    if (!authenticated && suppliedCronSecret) {
      const verification = await adminClient.rpc('verify_attendance_cron_token', { p_token: suppliedCronSecret });
      authenticated = verification.error === null && verification.data === true;
    }
    if (!authenticated) return json({ error: 'Scheduled sync authentication failed' }, 401);
  } else {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: '请先登录。' }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: authUser, error: authError } = await userClient.auth.getUser();
    if (authError || !authUser.user) return json({ error: '登录状态已失效，请重新登录。' }, 401);
    const { data: profile, error: profileError } = await adminClient.from('profiles').select('id,role,is_active,deleted_at').eq('id', authUser.user.id).single();
    if (profileError || profile?.role !== 'admin' || !profile.is_active || profile.deleted_at) return json({ error: '当前账号没有考勤管理权限。' }, 403);
    actorId = profile.id;
    const { data: access, error: accessError } = await adminClient.from('profile_store_access').select('store_id').eq('profile_id', profile.id);
    if (accessError) return json({ error: '无法确认管理员门店范围。' }, 500);
    allowedStoreIds = (access ?? []).map((item) => item.store_id);
  }

  let enterpriseConfigs: ReturnType<typeof loadDingTalkEnterpriseConfigs>;
  try {
    enterpriseConfigs = loadDingTalkEnterpriseConfigs((key) => Deno.env.get(key));
  } catch {
    return json({ error: '钉钉服务尚未完成安全配置。' }, 503);
  }
  const clientByCorp = new Map(enterpriseConfigs.map((config) => [config.corpId, new DingTalkClient(config)]));
  const configByCorp = new Map(enterpriseConfigs.map((config) => [config.corpId, config]));
  const jobCorpId = enterpriseConfigs.length === 1 ? enterpriseConfigs[0].corpId : 'multi-enterprise';

  if (payload.action === 'enqueue-history-sync') {
    if (!monthPattern.test(payload.startMonth) || !monthPattern.test(payload.endMonth) || payload.startMonth > payload.endMonth) {
      return json({ error: '请选择正确的开始月份和结束月份。' }, 400);
    }
    if (payload.storeId && (!uuidPattern.test(payload.storeId) || !allowedStoreIds.includes(payload.storeId))) {
      return json({ error: '当前管理员无权同步该门店。' }, 403);
    }
    const months = monthsBetween(payload.startMonth, payload.endMonth);
    if (months.length > 120) return json({ error: '单次最多可建立 120 个月的历史同步任务。' }, 400);
    const rows = months.map((month) => ({
      corp_id: jobCorpId,
      sync_type: 'history_month' as const,
      scope_type: payload.storeId ? 'store' as const : 'organization' as const,
      month_start: `${month}-01`,
      range_start: `${month}-01`,
      range_end: month === datePart(new Date(), timezone).slice(0, 7) ? datePart(new Date(), timezone) : monthEnd(month),
      store_id: payload.storeId ?? null,
      trigger_type: 'manual' as const,
      initiated_by: actorId,
      status: 'queued' as const,
      progress_cursor: { queuedByRange: true },
    }));
    const { data: queued, error } = await adminClient.from('attendance_sync_jobs').insert(rows).select('id');
    if (error) return json({ error: '无法建立历史考勤同步队列。' }, 500);
    return json({ status: 'queued', queuedCount: queued?.length ?? 0, message: `已建立 ${queued?.length ?? 0} 个月的同步队列，后台将按月份自动处理。` });
  }

  if (payload.action === 'refresh-directory') {
    const { data: job, error: jobError } = await adminClient.from('attendance_sync_jobs').insert({
      corp_id: jobCorpId, sync_type: 'directory', scope_type: 'organization', trigger_type: 'manual', initiated_by: actorId, status: 'running', started_at: new Date().toISOString(),
    }).select('id').single();
    if (jobError || !job) return json({ error: '无法创建通讯录同步任务。' }, 500);
    try {
      const now = new Date().toISOString();
      let employeeCount = 0;
      for (const config of enterpriseConfigs) {
        const client = clientByCorp.get(config.corpId)!;
        const rootDepartmentIds = unique((payload.rootDepartmentIds?.length ? payload.rootDepartmentIds : config.rootDepartmentIds).map((item) => item.trim()).filter(Boolean));
        const employees = await client.listEmployees(rootDepartmentIds);
        employeeCount += employees.length;
        const rows = employees.map((employee) => ({
          corp_id: config.corpId, dingtalk_user_id: employee.dingtalkUserId, union_id: employee.unionId,
          display_name: employee.displayName, mobile_masked: employee.mobileMasked, job_number: employee.jobNumber,
          department_ids: employee.departmentIds, is_active: employee.isActive, last_synced_at: now,
        }));
        const enterpriseSave = await adminClient.from('dingtalk_enterprises').upsert({ corp_id: config.corpId, display_name: config.displayName, is_active: true, last_directory_synced_at: now });
        if (enterpriseSave.error) throw new Error(enterpriseSave.error.message);
        const { error } = rows.length ? await adminClient.from('dingtalk_employee_directory').upsert(rows, { onConflict: 'corp_id,dingtalk_user_id' }) : { error: null };
        if (error) throw new Error(error.message);
        const activeUserIds = new Set(rows.map((row) => row.dingtalk_user_id));
        const { data: existing, error: existingError } = await adminClient.from('dingtalk_employee_directory').select('id,dingtalk_user_id').eq('corp_id', config.corpId).eq('is_active', true);
        if (existingError) throw new Error(existingError.message);
        const missingDirectoryIds = (existing ?? []).filter((item) => !activeUserIds.has(item.dingtalk_user_id)).map((item) => item.id);
        for (const ids of chunk(missingDirectoryIds, 100)) {
          const { error: directoryError } = await adminClient.from('dingtalk_employee_directory').update({ is_active: false, last_synced_at: now }).in('id', ids);
          if (directoryError) throw new Error(directoryError.message);
          const { error: bindingError } = await adminClient.from('dingtalk_employee_bindings').update({ binding_status: 'error', error_message: '钉钉通讯录中已找不到该员工，请管理员确认或重新绑定。', last_verified_at: now }).eq('binding_status', 'active').in('directory_user_id', ids);
          if (bindingError) throw new Error(bindingError.message);
        }
      }
      await adminClient.from('attendance_sync_jobs').update({ status: 'succeeded', success_count: employeeCount, inserted_count: employeeCount, finished_at: now }).eq('id', job.id);
      return json({ jobId: job.id, status: 'succeeded', employeeCount, enterpriseCount: enterpriseConfigs.length, message: `已更新 ${enterpriseConfigs.length} 个企业的 ${employeeCount} 名钉钉员工。` });
    } catch (error) {
      await adminClient.from('attendance_sync_jobs').update({ status: 'failed', failure_count: 1, error_summary: publicError(error), finished_at: new Date().toISOString() }).eq('id', job.id);
      return json({ jobId: job.id, error: publicError(error) }, 502);
    }
  }

  let startDate: string;
  let endDate: string;
  let syncType: 'current_month' | 'month' | 'date_range' | 'employee' | 'history_month';
  const triggerType: 'manual' | 'scheduled' | 'retry' = isScheduled ? 'scheduled' : payload.action === 'retry-job' ? 'retry' : 'manual';
  let requestedStoreId: string | null = null;
  let requestedProfileId: string | null = null;
  let claimedHistoryJob: Record<string, unknown> | null = null;
  const today = datePart(new Date(), timezone);

  if (payload.action === 'retry-job') {
    if (!uuidPattern.test(payload.jobId)) return json({ error: '同步任务编号无效。' }, 400);
    const { data: previous, error } = await adminClient.from('attendance_sync_jobs').select('*').eq('id', payload.jobId).single();
    if (error || !previous || (previous.store_id && !allowedStoreIds.includes(previous.store_id))) return json({ error: '找不到允许重试的同步任务。' }, 404);
    if (previous.sync_type === 'directory') return json({ error: '通讯录任务请使用“更新钉钉员工通讯录”重新执行。' }, 400);
    if (!previous.range_start || !previous.range_end) return json({ error: '该同步任务缺少可重试的日期范围。' }, 400);
    startDate = previous.range_start; endDate = previous.range_end; requestedStoreId = previous.store_id; requestedProfileId = previous.profile_id; syncType = previous.sync_type === 'employee' ? 'employee' : 'date_range';
  } else if (payload.action === 'sync') {
    if (payload.storeId && (!uuidPattern.test(payload.storeId) || !allowedStoreIds.includes(payload.storeId))) return json({ error: '当前管理员无权同步该门店。' }, 403);
    if (payload.profileId && !uuidPattern.test(payload.profileId)) return json({ error: '员工编号无效。' }, 400);
    requestedStoreId = payload.storeId ?? null; requestedProfileId = payload.profileId ?? null;
    const month = payload.month ?? today.slice(0, 7);
    if (!monthPattern.test(month)) return json({ error: '月份格式应为 YYYY-MM。' }, 400);
    startDate = `${month}-01`; endDate = month === today.slice(0, 7) ? today : monthEnd(month);
    syncType = requestedProfileId ? 'employee' : month === today.slice(0, 7) ? 'current_month' : 'month';
  } else if (payload.action === 'scheduled-sync') {
    if (payload.mode === 'history-queue') {
      const claimed = await adminClient.rpc('claim_attendance_history_sync_job');
      if (claimed.error) return json({ error: '无法读取历史同步队列。' }, 500);
      if (!claimed.data) return json({ status: 'skipped', message: '历史同步队列当前为空。' });
      claimedHistoryJob = claimed.data as Record<string, unknown>;
      startDate = String(claimedHistoryJob.range_start);
      endDate = String(claimedHistoryJob.range_end);
      requestedStoreId = claimedHistoryJob.store_id ? String(claimedHistoryJob.store_id) : null;
      requestedProfileId = claimedHistoryJob.profile_id ? String(claimedHistoryJob.profile_id) : null;
      syncType = 'history_month';
    } else {
    if (payload.mode === 'month-start' && today.slice(8, 10) !== '01') {
      return json({ status: 'skipped', message: '当前企业日期不是每月 1 日，月初回补任务已安全跳过。' });
    }
    startDate = payload.mode === 'month-start' ? shiftDate(today.slice(0, 7) + '-01', -5) : shiftDate(today, -6);
    endDate = today; syncType = 'date_range';
    }
  } else {
    return json({ error: '未知考勤操作。' }, 400);
  }

  let bindingsQuery = adminClient.from('dingtalk_employee_bindings').select('profile_id,corp_id,dingtalk_user_id,store_id').eq('binding_status', 'active');
  if (requestedProfileId) bindingsQuery = bindingsQuery.eq('profile_id', requestedProfileId);
  const { data: bindingRows, error: bindingError } = await bindingsQuery;
  if (bindingError) return json({ error: '无法读取员工绑定。' }, 500);
  const profileIds = (bindingRows ?? []).map((item) => item.profile_id);
  const { data: profiles, error: profilesError } = profileIds.length
    ? await adminClient.from('profiles').select('id,store_id,is_active,deleted_at').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) return json({ error: '无法读取员工门店信息。' }, 500);
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const bindings: AttendanceBindingInput[] = (bindingRows ?? []).flatMap((binding) => {
    const profile = profileMap.get(binding.profile_id);
    if (!profile?.is_active || profile.deleted_at) return [];
    if (!isScheduled && (!allowedStoreIds.includes(binding.store_id) || (requestedStoreId && binding.store_id !== requestedStoreId))) return [];
    if (isScheduled && requestedStoreId && binding.store_id !== requestedStoreId) return [];
    return [{ corpId: binding.corp_id, dingtalkUserId: binding.dingtalk_user_id, profileId: binding.profile_id, storeId: binding.store_id }];
  });

  const createdJob = claimedHistoryJob
    ? { data: { id: String(claimedHistoryJob.id) }, error: null }
    : await adminClient.from('attendance_sync_jobs').insert({
      corp_id: jobCorpId, sync_type: syncType, scope_type: requestedProfileId ? 'employee' : requestedStoreId ? 'store' : 'organization',
      month_start: `${startDate.slice(0, 7)}-01`, range_start: startDate, range_end: endDate,
      store_id: requestedStoreId, profile_id: requestedProfileId, trigger_type: triggerType, initiated_by: actorId,
      status: 'running', started_at: new Date().toISOString(), progress_cursor: { totalEmployees: bindings.length, completedEmployees: 0 },
    }).select('id').single();
  const job = createdJob.data;
  if (createdJob.error || !job) return json({ error: '无法创建考勤同步任务。' }, 500);
  if (claimedHistoryJob) await adminClient.from('attendance_sync_jobs').update({ progress_cursor: { totalEmployees: bindings.length, completedEmployees: 0 } }).eq('id', job.id);
  if (actorId) await adminClient.from('attendance_audit_logs').insert({ actor_id: actorId, action: triggerType === 'retry' ? 'sync_retried' : 'sync_requested', entity_type: 'sync_job', entity_id: job.id, store_id: requestedStoreId, metadata: { startDate, endDate, employeeCount: bindings.length } });

  let successCount = 0; let failureCount = 0; let insertedCount = 0; let updatedCount = 0; let skippedCount = 0;
  const schedulesByCorp = new Map<string, Record<string, unknown>[]>();
  try {
    for (const corpId of unique(bindings.map((binding) => binding.corpId))) {
      const client = clientByCorp.get(corpId);
      if (!client) throw new Error(`DingTalk enterprise ${corpId} is not configured`);
      schedulesByCorp.set(corpId, await client.listSchedules(startDate, endDate));
    }
  } catch (error) {
    const message = publicError(error);
    await adminClient.from('attendance_sync_jobs').update({ status: 'failed', failure_count: bindings.length, error_summary: message, finished_at: new Date().toISOString() }).eq('id', job.id);
    return json({ jobId: job.id, status: 'failed', successCount: 0, failureCount: bindings.length, insertedCount: 0, updatedCount: 0, skippedCount: 0, message }, 502);
  }
  for (const binding of bindings) {
    try {
      const client = clientByCorp.get(binding.corpId);
      const config = configByCorp.get(binding.corpId);
      if (!client || !config) throw new Error(`DingTalk enterprise ${binding.corpId} is not configured`);
      const bundle = await client.getAttendanceBundle([binding.dingtalkUserId], startDate, endDate);
      bundle.schedules = schedulesByCorp.get(binding.corpId) ?? [];
      const days = normalizeAttendanceBundle(binding, bundle);
      const normalizedDates = new Set(days.map((day) => day.attendanceDate));
      const { data: persistedDays, error: persistedDaysError } = await adminClient.from('attendance_daily_records')
        .select('id,attendance_date,enterprise_timezone,planned_on_at,planned_off_at')
        .eq('corp_id', binding.corpId)
        .eq('profile_id', binding.profileId)
        .gte('attendance_date', startDate)
        .lte('attendance_date', endDate);
      if (persistedDaysError) throw new Error(persistedDaysError.message);
      const staleDailyIds = (persistedDays ?? []).filter((item) => {
        if (normalizedDates.has(item.attendance_date)) return false;
        const recordTimezone = item.enterprise_timezone || config.timezone;
        const plannedDates = [item.planned_on_at, item.planned_off_at]
          .filter(Boolean)
          .map((value) => datePart(new Date(value), recordTimezone));
        return plannedDates.length > 0 && plannedDates.every((plannedDate) => plannedDate !== item.attendance_date);
      }).map((item) => item.id);
      for (const ids of chunk(staleDailyIds, 100)) {
        const { error: staleDeleteError } = await adminClient.from('attendance_daily_records').delete().in('id', ids);
        if (staleDeleteError) throw new Error(staleDeleteError.message);
      }
      if (!days.length) skippedCount += 1;
      for (const day of days) {
        const { data: existing } = await adminClient.from('attendance_daily_records').select('id').eq('corp_id', day.corpId).eq('profile_id', day.profileId).eq('attendance_date', day.attendanceDate).maybeSingle();
        const { data: daily, error: dailyError } = await adminClient.from('attendance_daily_records').upsert({
          corp_id: day.corpId, profile_id: day.profileId, store_id: day.storeId, attendance_date: day.attendanceDate,
          enterprise_timezone: config.timezone, shift_id: day.shiftId, shift_name: day.shiftName, planned_on_at: day.plannedOnAt,
          planned_off_at: day.plannedOffAt, actual_on_at: day.actualOnAt, actual_off_at: day.actualOffAt,
          on_duty_result: day.onDutyResult, off_duty_result: day.offDutyResult, daily_status: day.dailyStatus,
          is_attended: day.isAttended, late_minutes: day.lateMinutes, early_minutes: day.earlyMinutes,
          missing_punch: day.missingPunch, exception_note: day.exceptionNote, dingtalk_result_ids: day.dingtalkResultIds,
          source_updated_at: day.sourceUpdatedAt, last_synced_at: new Date().toISOString(),
        }, { onConflict: 'corp_id,profile_id,attendance_date' }).select('id').single();
        if (dailyError || !daily) throw new Error(dailyError?.message ?? 'daily attendance upsert failed');
        if (existing) updatedCount += 1; else insertedCount += 1;
        if (day.punches.length) {
          const { error: punchError } = await adminClient.from('attendance_punch_records').upsert(day.punches.map((punch) => ({
            daily_record_id: daily.id, corp_id: punch.corpId, profile_id: punch.profileId, store_id: punch.storeId,
            dingtalk_record_id: punch.dingtalkRecordId, punch_time: punch.punchTime, check_type: punch.checkType,
            source_type: punch.sourceType, time_result: punch.timeResult, location_result: punch.locationResult,
            location_name: punch.locationName, is_approved_correction: punch.isApprovedCorrection, last_synced_at: new Date().toISOString(),
          })), { onConflict: 'corp_id,dingtalk_record_id' });
          if (punchError) throw new Error(punchError.message);
        }
      }
      successCount += 1;
    } catch (error) {
      failureCount += 1;
      const retryable = error instanceof DingTalkApiError ? error.retryable : true;
      await adminClient.from('attendance_sync_failures').insert({
        sync_job_id: job.id, profile_id: binding.profileId, dingtalk_user_id: binding.dingtalkUserId,
        stage: error instanceof DingTalkApiError ? 'result' : 'persist', attempt_count: 1,
        error_code: error instanceof DingTalkApiError ? error.code : 'SYNC_EMPLOYEE_FAILED', error_message: publicError(error), retryable,
      });
    }
    await adminClient.from('attendance_sync_jobs').update({ progress_cursor: { totalEmployees: bindings.length, completedEmployees: successCount + failureCount, currentProfileId: binding.profileId }, success_count: successCount, failure_count: failureCount, inserted_count: insertedCount, updated_count: updatedCount, skipped_count: skippedCount }).eq('id', job.id);
  }

  const { status, message } = summarizeAttendanceSync(bindings.length, successCount, failureCount);
  await adminClient.from('attendance_sync_jobs').update({ status, success_count: successCount, failure_count: failureCount, inserted_count: insertedCount, updated_count: updatedCount, skipped_count: skippedCount, error_summary: failureCount ? message : null, finished_at: new Date().toISOString(), progress_cursor: { totalEmployees: bindings.length, completedEmployees: bindings.length } }).eq('id', job.id);
  return json({ jobId: job.id, status, successCount, failureCount, insertedCount, updatedCount, skippedCount, message }, status === 'failed' && bindings.length > 0 ? 502 : 200);
});
