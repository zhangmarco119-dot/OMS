-- Overtime approval, configurable rate, penalty evidence, notifications, and
-- payroll integration. All calendar cutoffs use Asia/Shanghai.

alter table public.payroll_employee_rules alter column change_reason set default '';

create table public.payroll_overtime_rates (
  id uuid primary key default gen_random_uuid(),
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  effective_from date not null unique,
  effective_to date,
  change_reason text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

insert into public.payroll_overtime_rates(hourly_rate, effective_from, change_reason)
values (25, (now() at time zone 'Asia/Shanghai')::date, '系统默认加班时薪');

create table public.payroll_overtime_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  overtime_date date not null,
  hours numeric(6,2) not null check (hours > 0 and hours <= 16),
  reason text not null check (nullif(trim(reason), '') is not null),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approved_hourly_rate numeric(10,2) check (approved_hourly_rate >= 0),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, store_id, overtime_date),
  check ((status = 'approved' and approved_hourly_rate is not null and reviewed_by is not null and reviewed_at is not null)
    or status <> 'approved')
);

create trigger payroll_overtime_requests_touch_updated_at
before update on public.payroll_overtime_requests
for each row execute function public.touch_updated_at();

create table public.payroll_penalty_assets (
  id uuid primary key default gen_random_uuid(),
  penalty_id uuid not null references public.payroll_penalties(id) on delete cascade,
  bucket text not null default 'payroll-evidence' check (bucket = 'payroll-evidence'),
  object_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.payroll_overtime_rates enable row level security;
alter table public.payroll_overtime_requests enable row level security;
alter table public.payroll_penalty_assets enable row level security;

create policy payroll_overtime_rates_read on public.payroll_overtime_rates
for select to authenticated using (true);
create policy payroll_overtime_rates_admin_write on public.payroll_overtime_rates
for all to authenticated using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy payroll_overtime_requests_read on public.payroll_overtime_requests
for select to authenticated using (
  profile_id = auth.uid()
  or public.current_user_role() = 'admin'
  or (public.current_user_role() = 'manager' and public.has_store_access(store_id))
);

create policy payroll_penalty_assets_read on public.payroll_penalty_assets
for select to authenticated using (
  uploaded_by = auth.uid()
  or exists (select 1 from public.payroll_penalties penalty where penalty.id = penalty_id and penalty.profile_id = auth.uid())
  or public.current_user_role() = 'admin'
);
create policy payroll_penalty_assets_admin_insert on public.payroll_penalty_assets
for insert to authenticated with check (public.current_user_role() = 'admin' and uploaded_by = auth.uid());
create policy payroll_penalty_assets_admin_delete on public.payroll_penalty_assets
for delete to authenticated using (public.current_user_role() = 'admin');

grant select, insert, update, delete on public.payroll_overtime_rates,
  public.payroll_overtime_requests, public.payroll_penalty_assets to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payroll-evidence', 'payroll-evidence', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy payroll_evidence_objects_select on storage.objects
for select to authenticated using (
  bucket_id = 'payroll-evidence' and (
    owner_id = auth.uid()::text
    or public.current_user_role() = 'admin'
    or exists (
      select 1 from public.payroll_penalty_assets asset
      join public.payroll_penalties penalty on penalty.id = asset.penalty_id
      where asset.object_path = name and penalty.profile_id = auth.uid()
    )
  )
);
create policy payroll_evidence_objects_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'payroll-evidence' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy payroll_evidence_objects_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'payroll-evidence' and (owner_id = auth.uid()::text or public.current_user_role() = 'admin')
);

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
begin
  if not public.can_admin_manage_attendance_profile(p_profile_id) then raise exception 'payroll profile access denied'; end if;
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
    confirmed, effective_from, effective_to, change_reason, created_by
  ) values (
    p_profile_id, coalesce((p_fields->>'monthlyBaseSalary')::numeric, 0),
    coalesce((p_fields->>'monthlyHousingAllowance')::numeric, 0), nullif(p_fields->>'fullPerformanceAmount', '')::numeric,
    nullif(p_fields->>'commissionRate', '')::numeric, coalesce((p_fields->>'housingEnabled')::boolean, false),
    coalesce((p_fields->>'performanceEnabled')::boolean, false), coalesce((p_fields->>'commissionEnabled')::boolean, false),
    coalesce((p_fields->>'confirmed')::boolean, false), v_effective_from, v_effective_to,
    trim(coalesce(p_fields->>'changeReason', '')), auth.uid()
  ) on conflict (profile_id, effective_from) do update set
    monthly_base_salary = excluded.monthly_base_salary, monthly_housing_allowance = excluded.monthly_housing_allowance,
    full_performance_amount = excluded.full_performance_amount, commission_rate = excluded.commission_rate,
    housing_enabled = excluded.housing_enabled, performance_enabled = excluded.performance_enabled,
    commission_enabled = excluded.commission_enabled, confirmed = excluded.confirmed,
    effective_to = excluded.effective_to, change_reason = excluded.change_reason,
    created_by = excluded.created_by, created_at = now()
  returning id into v_rule_id;
  delete from public.payroll_employee_commission_stores where rule_id = v_rule_id;
  insert into public.payroll_employee_commission_stores(rule_id, store_id)
    select v_rule_id, store_id from unnest(coalesce(p_store_ids, '{}'::uuid[])) store_id;
  return v_rule_id;
end;
$$;

create or replace function public.admin_save_payroll_overtime_rate(p_hourly_rate numeric, p_effective_from date, p_change_reason text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_effective_to date;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_hourly_rate < 0 then raise exception 'hourly rate must not be negative'; end if;
  select min(effective_from) - 1 into v_effective_to from public.payroll_overtime_rates where effective_from > p_effective_from;
  update public.payroll_overtime_rates set effective_to = p_effective_from - 1
    where effective_from < p_effective_from and (effective_to is null or effective_to >= p_effective_from);
  insert into public.payroll_overtime_rates(hourly_rate, effective_from, effective_to, change_reason, created_by)
  values (p_hourly_rate, p_effective_from, v_effective_to, trim(coalesce(p_change_reason, '')), auth.uid())
  on conflict (effective_from) do update set hourly_rate = excluded.hourly_rate,
    effective_to = excluded.effective_to, change_reason = excluded.change_reason,
    created_by = excluded.created_by, created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_payroll_overtime_request(p_store_id uuid, p_overtime_date date, p_hours numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.payroll_overtime_requests; v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if public.current_user_role() not in ('staff','manager') then raise exception 'employee permission required'; end if;
  if not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  if p_overtime_date > v_today then raise exception 'overtime date cannot be in the future'; end if;
  if p_hours <= 0 or p_hours > 16 then raise exception 'overtime hours must be between 0 and 16'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'overtime reason is required'; end if;
  insert into public.payroll_overtime_requests(profile_id, store_id, overtime_date, hours, reason)
  values (auth.uid(), p_store_id, p_overtime_date, p_hours, trim(p_reason)) returning * into v_request;
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  select manager.id, p_store_id, 'payroll_overtime_submitted', '加班申请待审批',
    profile.display_name || '申报 ' || p_overtime_date || ' 加班 ' || p_hours || ' 小时',
    'payroll_overtime', v_request.id, 'overtime-submitted:' || v_request.id || ':' || manager.id
  from public.profiles manager cross join public.profiles profile
  where profile.id = auth.uid() and manager.id <> auth.uid() and manager.role = 'manager' and manager.is_active and manager.deleted_at is null
    and (manager.store_id = p_store_id or exists (select 1 from public.profile_store_access access where access.profile_id = manager.id and access.store_id = p_store_id))
  on conflict (dedupe_key) do nothing;
  return to_jsonb(v_request);
exception when unique_violation then
  raise exception '该员工在所选门店和日期已有加班申请';
end;
$$;

create or replace function public.review_payroll_overtime_request(p_request_id uuid, p_action text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.payroll_overtime_requests; v_rate numeric;
begin
  select * into v_request from public.payroll_overtime_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'overtime request not found'; end if;
  if public.current_user_role() <> 'manager' or not public.has_store_access(v_request.store_id) then raise exception 'manager approval permission required'; end if;
  if v_request.profile_id = auth.uid() then raise exception 'manager cannot review own overtime request'; end if;
  if v_request.status <> 'pending' then raise exception 'only pending overtime can be reviewed'; end if;
  if p_action not in ('approved','rejected') then raise exception 'invalid overtime review action'; end if;
  if p_action = 'rejected' and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'rejection reason is required'; end if;
  if p_action = 'approved' then
    select hourly_rate into v_rate from public.payroll_overtime_rates
      where effective_from <= v_request.overtime_date and (effective_to is null or effective_to >= v_request.overtime_date)
      order by effective_from desc limit 1;
    if v_rate is null then raise exception 'overtime hourly rate is not configured'; end if;
  end if;
  update public.payroll_overtime_requests set status = p_action,
    approved_hourly_rate = case when p_action = 'approved' then v_rate else null end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_request_id returning * into v_request;
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values (v_request.profile_id, v_request.store_id, 'payroll_overtime_' || p_action,
    case when p_action = 'approved' then '加班申请已通过' else '加班申请已驳回' end,
    v_request.overtime_date || ' · ' || v_request.hours || ' 小时' || case when p_action = 'rejected' then ' · ' || coalesce(v_request.review_note, '') else '' end,
    'payroll_overtime', v_request.id, 'overtime-reviewed:' || v_request.id || ':' || p_action)
  on conflict (dedupe_key) do nothing;
  return to_jsonb(v_request);
end;
$$;

create or replace function public.admin_create_payroll_penalty(p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_penalty public.payroll_penalties; v_profile public.profiles; v_level text; v_default numeric;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  select * into v_profile from public.profiles where id = (p_fields->>'profileId')::uuid;
  if v_profile.id is null or not public.can_admin_manage_attendance_profile(v_profile.id) then raise exception 'payroll profile access denied'; end if;
  v_level := coalesce(p_fields->>'eventLevel', 'warning');
  v_default := case v_level when 'reminder' then 0 when 'warning' then 3 when 'formal_warning' then 5 when 'serious' then 10 else null end;
  if v_default is null then raise exception 'invalid penalty event level'; end if;
  insert into public.payroll_penalties(profile_id, event_date, reason, amount, event_level, performance_deduction, created_by)
  values (v_profile.id, (p_fields->>'eventDate')::date, trim(p_fields->>'reason'),
    coalesce((p_fields->>'amount')::numeric, 0), v_level,
    coalesce(nullif(p_fields->>'performanceDeduction', '')::numeric, v_default), auth.uid())
  returning * into v_penalty;
  insert into public.notifications(recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key)
  values (v_profile.id, v_profile.store_id, 'payroll_penalty_created', '新的处罚记录',
    v_penalty.event_date || ' · ' || v_penalty.reason || case when v_penalty.amount > 0 then ' · 罚款 ' || v_penalty.amount || ' 元' else '' end,
    'payroll_penalty', v_penalty.id, 'payroll-penalty:' || v_penalty.id)
  on conflict (dedupe_key) do nothing;
  return to_jsonb(v_penalty);
end;
$$;

alter function public.get_payroll_estimate(uuid, date)
  rename to calculate_payroll_estimate_without_overtime;

create function public.get_payroll_estimate(
  p_profile_id uuid,
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb; v_hours numeric; v_amount numeric; v_updated timestamptz; v_rate numeric;
begin
  perform set_config('TimeZone', 'Asia/Shanghai', true);
  v_result := public.calculate_payroll_estimate_without_overtime(p_profile_id, p_as_of);
  select coalesce(sum(hours), 0), coalesce(sum(hours * approved_hourly_rate), 0), max(updated_at)
    into v_hours, v_amount, v_updated
  from public.payroll_overtime_requests where profile_id = p_profile_id and status = 'approved'
    and overtime_date between date_trunc('month', p_as_of)::date and p_as_of;
  select hourly_rate into v_rate from public.payroll_overtime_rates
    where effective_from <= p_as_of and (effective_to is null or effective_to >= p_as_of)
    order by effective_from desc limit 1;
  v_result := jsonb_set(v_result, '{overtimeHours}', to_jsonb(v_hours), true);
  v_result := jsonb_set(v_result, '{overtimeHourlyRate}', to_jsonb(v_rate), true);
  v_result := jsonb_set(v_result, '{accruedOvertime}', to_jsonb(v_amount), true);
  v_result := jsonb_set(v_result, '{overtimeUpdatedAt}', coalesce(to_jsonb(v_updated), 'null'::jsonb), true);
  v_result := jsonb_set(v_result, '{incomeSubtotalKnown}', to_jsonb(round(coalesce((v_result->>'incomeSubtotalKnown')::numeric, 0) + v_amount, 2)), true);
  v_result := jsonb_set(v_result, '{knownEstimatedPayable}', to_jsonb(round(coalesce((v_result->>'knownEstimatedPayable')::numeric, 0) + v_amount, 2)), true);
  if v_result->>'estimatedPayable' is not null then
    v_result := jsonb_set(v_result, '{estimatedPayable}', to_jsonb(round((v_result->>'estimatedPayable')::numeric + v_amount, 2)), true);
  end if;
  return v_result;
end;
$$;

create or replace function public.admin_payroll_estimates(
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date),
  p_store_id uuid default null,
  p_search text default ''
)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_result jsonb;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  with targets as (
    select profile.id from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and profile.display_name not in ('李荣珊','李荣妹','李荣美') and public.can_admin_manage_attendance_profile(profile.id)
      and (p_store_id is null or profile.store_id = p_store_id or exists (
        select 1 from public.dingtalk_employee_bindings binding where binding.profile_id = profile.id and binding.store_id = p_store_id and binding.binding_status = 'active'))
      and (trim(coalesce(p_search, '')) = '' or profile.display_name ilike '%' || trim(p_search) || '%' or profile.username ilike '%' || trim(p_search) || '%')
  ), estimates as (select public.get_payroll_estimate(target.id, p_as_of) estimate from targets target)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(estimate order by estimate->>'displayName'), '[]'::jsonb),
    'employeeCount', count(*), 'completeCount', count(*) filter (where (estimate->>'dataComplete')::boolean),
    'incompleteCount', count(*) filter (where not (estimate->>'dataComplete')::boolean),
    'knownEstimatedTotal', coalesce(sum((estimate->>'knownEstimatedPayable')::numeric), 0),
    'completeEstimatedTotal', coalesce(sum((estimate->>'estimatedPayable')::numeric) filter (where estimate->>'estimatedPayable' is not null), 0)
  ) into v_result from estimates;
  return v_result;
end;
$$;

revoke all on function public.admin_save_payroll_overtime_rate(numeric,date,text),
  public.submit_payroll_overtime_request(uuid,date,numeric,text),
  public.review_payroll_overtime_request(uuid,text,text), public.admin_create_payroll_penalty(jsonb),
  public.get_payroll_estimate(uuid,date), public.calculate_payroll_estimate_without_overtime(uuid,date) from public;
grant execute on function public.admin_save_payroll_overtime_rate(numeric,date,text),
  public.submit_payroll_overtime_request(uuid,date,numeric,text),
  public.review_payroll_overtime_request(uuid,text,text), public.admin_create_payroll_penalty(jsonb),
  public.get_payroll_estimate(uuid,date) to authenticated;
