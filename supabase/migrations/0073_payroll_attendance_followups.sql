-- Payroll award separation, regularization proration, missing-punch reminders,
-- and the revised overtime-hour range. All dates use Asia/Shanghai.

alter table public.payroll_employee_rules
  add column service_award_enabled boolean not null default false,
  add column service_award_amount numeric(12,2) not null default 100,
  add column regularization_date date;

alter table public.payroll_employee_rules
  add constraint payroll_employee_rules_service_award_amount_check
  check (service_award_amount >= 0);

create table public.attendance_missing_punch_todos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  attendance_date date not null,
  missing_punch text not null check (missing_punch in ('on','off','both')),
  status text not null default 'pending' check (status in ('pending','completed')),
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, store_id, attendance_date)
);

create trigger attendance_missing_punch_todos_touch_updated_at
before update on public.attendance_missing_punch_todos
for each row execute function public.touch_updated_at();

alter table public.attendance_missing_punch_todos enable row level security;

create policy attendance_missing_punch_todos_read on public.attendance_missing_punch_todos
for select to authenticated using (
  profile_id = auth.uid()
  or public.can_admin_manage_attendance_profile(profile_id)
);

grant select on public.attendance_missing_punch_todos to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.attendance_missing_punch_todos;
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.sync_attendance_missing_punch_todo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.missing_punch in ('on','off','both') then
    insert into public.attendance_missing_punch_todos(
      profile_id, store_id, attendance_date, missing_punch, due_at
    ) values (
      new.profile_id,
      new.store_id,
      new.attendance_date,
      new.missing_punch,
      ((date_trunc('month', new.attendance_date) + interval '1 month')::date::timestamp
        at time zone 'Asia/Shanghai')
    )
    on conflict (profile_id, store_id, attendance_date) do update set
      missing_punch = excluded.missing_punch,
      due_at = excluded.due_at,
      updated_at = now();
  else
    update public.attendance_missing_punch_todos
    set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where profile_id = new.profile_id
      and store_id = new.store_id
      and attendance_date = new.attendance_date
      and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger attendance_daily_records_sync_missing_punch_todo
after insert or update of missing_punch on public.attendance_daily_records
for each row execute function public.sync_attendance_missing_punch_todo();

insert into public.attendance_missing_punch_todos(
  profile_id, store_id, attendance_date, missing_punch, due_at
)
select daily.profile_id,
  daily.store_id,
  daily.attendance_date,
  daily.missing_punch,
  ((date_trunc('month', daily.attendance_date) + interval '1 month')::date::timestamp
    at time zone 'Asia/Shanghai')
from public.attendance_daily_records daily
where daily.missing_punch in ('on','off','both')
  and daily.attendance_date >= date_trunc('month', now() at time zone 'Asia/Shanghai')::date
on conflict (profile_id, store_id, attendance_date) do update set
  missing_punch = excluded.missing_punch,
  due_at = excluded.due_at,
  updated_at = now();

create or replace function public.complete_attendance_missing_punch_todo(p_todo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.attendance_missing_punch_todos;
begin
  update public.attendance_missing_punch_todos
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_todo_id
    and profile_id = auth.uid()
    and status = 'pending'
  returning * into v_row;
  if v_row.id is null then
    raise exception '未找到可完成的补卡提醒';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.sync_attendance_missing_punch_todo() from public, anon, authenticated;
revoke all on function public.complete_attendance_missing_punch_todo(uuid) from public, anon;
grant execute on function public.complete_attendance_missing_punch_todo(uuid) to authenticated;

create or replace function public.admin_save_payroll_employee_rule(
  p_profile_id uuid,
  p_fields jsonb,
  p_store_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_effective_from date := coalesce((p_fields->>'effectiveFrom')::date, (now() at time zone 'Asia/Shanghai')::date);
  v_effective_to date;
  v_rule_id uuid;
  v_store_id uuid;
  v_bonus_enabled boolean := coalesce((p_fields->>'fullAttendanceBonusEnabled')::boolean, false);
  v_bonus_amount numeric := coalesce(nullif(p_fields->>'fullAttendanceBonusAmount', '')::numeric, 0);
  v_service_enabled boolean := coalesce((p_fields->>'serviceAwardEnabled')::boolean, false);
  v_service_amount numeric := coalesce(nullif(p_fields->>'serviceAwardAmount', '')::numeric, 100);
  v_regularization_date date := nullif(p_fields->>'regularizationDate', '')::date;
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll profile access denied'; end if;
  if v_bonus_amount < 0 then raise exception 'full attendance bonus amount must not be negative'; end if;
  if v_bonus_enabled and v_bonus_amount <= 0 then raise exception 'full attendance bonus amount is required'; end if;
  if v_service_amount < 0 then raise exception 'service award amount must not be negative'; end if;
  if v_service_enabled and v_service_amount <= 0 then raise exception 'service award amount is required'; end if;
  foreach v_store_id in array coalesce(p_store_ids, '{}'::uuid[]) loop
    if not public.has_store_access(v_store_id) then raise exception 'payroll store access denied'; end if;
  end loop;
  select min(effective_from) - 1 into v_effective_to from public.payroll_employee_rules
    where profile_id = p_profile_id and effective_from > v_effective_from;
  update public.payroll_employee_rules set effective_to = v_effective_from - 1
    where profile_id = p_profile_id and effective_from < v_effective_from and (effective_to is null or effective_to >= v_effective_from);
  insert into public.payroll_employee_rules(
    profile_id, monthly_base_salary, monthly_housing_allowance, full_performance_amount,
    commission_rate, housing_enabled, performance_enabled, commission_enabled,
    full_attendance_bonus_enabled, full_attendance_bonus_amount,
    service_award_enabled, service_award_amount, regularization_date,
    confirmed, effective_from, effective_to, change_reason, created_by
  ) values (
    p_profile_id, coalesce((p_fields->>'monthlyBaseSalary')::numeric, 0),
    coalesce((p_fields->>'monthlyHousingAllowance')::numeric, 0), nullif(p_fields->>'fullPerformanceAmount', '')::numeric,
    nullif(p_fields->>'commissionRate', '')::numeric, coalesce((p_fields->>'housingEnabled')::boolean, false),
    coalesce((p_fields->>'performanceEnabled')::boolean, false), coalesce((p_fields->>'commissionEnabled')::boolean, false),
    v_bonus_enabled, v_bonus_amount, v_service_enabled, v_service_amount, v_regularization_date,
    coalesce((p_fields->>'confirmed')::boolean, false), v_effective_from, v_effective_to,
    trim(coalesce(p_fields->>'changeReason', '')), auth.uid()
  ) on conflict (profile_id, effective_from) do update set
    monthly_base_salary = excluded.monthly_base_salary, monthly_housing_allowance = excluded.monthly_housing_allowance,
    full_performance_amount = excluded.full_performance_amount, commission_rate = excluded.commission_rate,
    housing_enabled = excluded.housing_enabled, performance_enabled = excluded.performance_enabled,
    commission_enabled = excluded.commission_enabled,
    full_attendance_bonus_enabled = excluded.full_attendance_bonus_enabled,
    full_attendance_bonus_amount = excluded.full_attendance_bonus_amount,
    service_award_enabled = excluded.service_award_enabled,
    service_award_amount = excluded.service_award_amount,
    regularization_date = excluded.regularization_date,
    confirmed = excluded.confirmed,
    effective_to = excluded.effective_to, change_reason = excluded.change_reason,
    created_by = excluded.created_by, created_at = now()
  returning id into v_rule_id;
  delete from public.payroll_employee_commission_stores where rule_id = v_rule_id;
  insert into public.payroll_employee_commission_stores(rule_id, store_id)
    select v_rule_id, store_id from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id;
  return v_rule_id;
end;
$$;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_before_award_separation;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_rule_id uuid;
  v_service_enabled boolean := false;
  v_service_amount numeric := 100;
  v_regularization_date date;
  v_attendance_days integer := 0;
  v_eligible_days integer := 0;
  v_full_days integer := 0;
  v_service_accrued numeric := 0;
  v_bonus numeric := 0;
  v_performance numeric := 0;
  v_commission numeric := 0;
  v_new_performance numeric := 0;
  v_new_commission numeric := 0;
  v_factor numeric := 1;
  v_delta numeric := 0;
  v_known numeric := 0;
  v_complete boolean := false;
  v_issues jsonb := '[]'::jsonb;
begin
  v_result := public.calculate_payroll_estimate_before_award_separation(p_profile_id, p_as_of);
  if nullif(v_result->>'ruleId', '') is not null then
    v_rule_id := (v_result->>'ruleId')::uuid;
    select rule.service_award_enabled, rule.service_award_amount, rule.regularization_date
      into v_service_enabled, v_service_amount, v_regularization_date
    from public.payroll_employee_rules rule
    where rule.id = v_rule_id;
  end if;

  v_attendance_days := coalesce((v_result->>'attendanceDays')::integer, 0);
  v_full_days := coalesce((v_result->>'fullAttendanceDays')::integer, 0);
  v_bonus := coalesce(nullif(v_result->>'accruedFullAttendanceBonus', '')::numeric, 0);
  v_performance := greatest(coalesce(nullif(v_result->>'accruedPerformance', '')::numeric, 0) - v_bonus, 0);
  v_commission := coalesce(nullif(v_result->>'accruedCommission', '')::numeric, 0);

  if v_regularization_date is null or v_regularization_date <= date_trunc('month', p_as_of)::date then
    v_eligible_days := v_attendance_days;
    v_factor := 1;
  elsif v_regularization_date > p_as_of then
    v_eligible_days := 0;
    v_factor := 0;
  else
    select count(distinct daily.attendance_date)::integer
      into v_eligible_days
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id
      and daily.is_attended
      and daily.attendance_date between v_regularization_date and p_as_of;
    v_factor := case when v_attendance_days > 0 then least(v_eligible_days::numeric / v_attendance_days, 1) else 0 end;
  end if;

  v_new_performance := round(v_performance * v_factor, 2);
  v_new_commission := round(v_commission * v_factor, 2);
  v_service_accrued := case
    when coalesce(v_service_enabled, false) and v_full_days > 0
      then round(coalesce(v_service_amount, 100) / v_full_days * least(v_attendance_days, v_full_days), 2)
    else 0
  end;
  -- The existing payable already includes the full-attendance bonus. Only move
  -- that amount out of accruedPerformance; do not remove it from the total.
  v_delta := (v_new_performance - v_performance) + (v_new_commission - v_commission) + v_service_accrued;
  v_known := round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_delta, 2);

  v_result := jsonb_set(v_result, '{accruedPerformance}', to_jsonb(v_new_performance), true);
  v_result := jsonb_set(v_result, '{accruedCommission}', to_jsonb(v_new_commission), true);
  v_result := jsonb_set(v_result, '{serviceAwardEnabled}', to_jsonb(coalesce(v_service_enabled, false)), true);
  v_result := jsonb_set(v_result, '{serviceAwardAmount}', to_jsonb(round(coalesce(v_service_amount, 100), 2)), true);
  v_result := jsonb_set(v_result, '{accruedServiceAward}', to_jsonb(v_service_accrued), true);
  v_result := jsonb_set(v_result, '{regularizationDate}', coalesce(to_jsonb(v_regularization_date), 'null'::jsonb), true);
  v_result := jsonb_set(v_result, '{eligibleAttendanceDays}', to_jsonb(v_eligible_days), true);
  v_result := jsonb_set(v_result, '{regularizationFactor}', to_jsonb(round(v_factor, 4)), true);
  v_result := jsonb_set(v_result, '{isProbation}', to_jsonb(v_regularization_date is not null and v_regularization_date > p_as_of), true);
  v_result := jsonb_set(v_result, '{incomeSubtotalKnown}', to_jsonb(round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_delta, 2)), true);
  v_result := jsonb_set(v_result, '{knownEstimatedPayable}', to_jsonb(v_known), true);

  select coalesce(jsonb_agg(issue), '[]'::jsonb)
    into v_issues
  from jsonb_array_elements_text(coalesce(v_result->'dataIssues', '[]'::jsonb)) issue
  where not (
    v_factor = 0
    and issue in ('任务数据不足，绩效待评分', '营业收入待更新')
  );

  v_complete := coalesce((v_result->>'ruleConfirmed')::boolean, false)
    and (v_factor = 0 or coalesce((v_result->>'performanceReady')::boolean, false))
    and (v_factor = 0 or coalesce((v_result->>'commissionReady')::boolean, false));
  v_result := jsonb_set(v_result, '{performanceReady}', to_jsonb(v_factor = 0 or coalesce((v_result->>'performanceReady')::boolean, false)), true);
  v_result := jsonb_set(v_result, '{commissionReady}', to_jsonb(v_factor = 0 or coalesce((v_result->>'commissionReady')::boolean, false)), true);
  v_result := jsonb_set(v_result, '{estimatedPayable}', case when v_complete then to_jsonb(v_known) else 'null'::jsonb end, true);
  v_result := jsonb_set(v_result, '{dataComplete}', to_jsonb(v_complete), true);
  v_result := jsonb_set(v_result, '{dataIssues}', v_issues, true);
  return v_result;
end;
$$;

revoke all on function public.calculate_payroll_estimate_before_award_separation(uuid,date) from public, anon, authenticated;
revoke all on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.get_payroll_estimate(uuid,date) from public, anon;
grant execute on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]), public.get_payroll_estimate(uuid,date) to authenticated;

alter table public.payroll_overtime_requests
  drop constraint if exists payroll_overtime_requests_hours_check;
alter table public.payroll_overtime_requests
  add constraint payroll_overtime_requests_hours_check
  check (hours >= 0 and hours <= 6 and mod(hours, 0.5) = 0);

create or replace function public.submit_payroll_overtime_request(
  p_store_id uuid,
  p_overtime_date date,
  p_hours numeric,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payroll_overtime_requests;
  v_requester_role text := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if v_requester_role not in ('staff', 'manager') then raise exception '仅员工和店长可以提交加班申请'; end if;
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的操作权限'; end if;
  if p_overtime_date > v_today or p_overtime_date < v_today - 5 then raise exception '加班日期只能选择今天或过去 5 日内'; end if;
  if p_hours < 0 or p_hours > 6 or mod(p_hours, 0.5) <> 0 then raise exception '加班小时必须按 0.5 小时递增，且在 0 至 6 小时之间'; end if;
  insert into public.payroll_overtime_requests(profile_id, store_id, overtime_date, hours, reason)
  values (auth.uid(), p_store_id, p_overtime_date, p_hours, trim(coalesce(p_reason, '')))
  returning * into v_request;
  perform public.notify_payroll_overtime_reviewers(v_request, v_requester_role, 'submitted');
  return to_jsonb(v_request);
exception when unique_violation then
  raise exception '该员工在所选门店和日期已有加班申请，可在加班记录中修改';
end;
$$;

create or replace function public.update_payroll_overtime_request(
  p_request_id uuid,
  p_store_id uuid,
  p_overtime_date date,
  p_hours numeric,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payroll_overtime_requests;
  v_requester_role text := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select * into v_request from public.payroll_overtime_requests
  where id = p_request_id and profile_id = auth.uid() for update;
  if v_request.id is null then raise exception '未找到加班申请'; end if;
  if v_requester_role not in ('staff', 'manager') then raise exception '仅员工和店长可以修改加班申请'; end if;
  if (v_request.created_at at time zone 'Asia/Shanghai')::date < v_today - 5 then raise exception '只能修改今天或过去 5 日内提交的加班申请'; end if;
  if not public.has_store_access(p_store_id) then raise exception '没有该门店的操作权限'; end if;
  if p_overtime_date > v_today or p_overtime_date < v_today - 5 then raise exception '加班日期只能选择今天或过去 5 日内'; end if;
  if p_hours < 0 or p_hours > 6 or mod(p_hours, 0.5) <> 0 then raise exception '加班小时必须按 0.5 小时递增，且在 0 至 6 小时之间'; end if;
  update public.payroll_overtime_requests set
    store_id = p_store_id, overtime_date = p_overtime_date, hours = p_hours,
    reason = trim(coalesce(p_reason, '')), status = 'pending', approved_hourly_rate = null,
    reviewed_by = null, reviewed_at = null, review_note = null, updated_at = now()
  where id = p_request_id returning * into v_request;
  perform public.notify_payroll_overtime_reviewers(v_request, v_requester_role, 'updated');
  return to_jsonb(v_request);
exception when unique_violation then
  raise exception '该员工在所选门店和日期已有另一条加班申请';
end;
$$;

revoke all on function public.submit_payroll_overtime_request(uuid,date,numeric,text),
  public.update_payroll_overtime_request(uuid,uuid,date,numeric,text) from public, anon;
grant execute on function public.submit_payroll_overtime_request(uuid,date,numeric,text),
  public.update_payroll_overtime_request(uuid,uuid,date,numeric,text) to authenticated;

-- Staff and managers may read the user manual uploaded to the database.
drop policy if exists v2_system_documents_admin_select on public.v2_system_documents;
drop policy if exists v2_system_documents_select on public.v2_system_documents;
drop policy if exists v2_system_documents_select_admin on public.v2_system_documents;
create policy v2_system_documents_select on public.v2_system_documents
for select to authenticated using (
  public.current_user_role() = 'admin'
  or audience = 'staff_manager'
);
