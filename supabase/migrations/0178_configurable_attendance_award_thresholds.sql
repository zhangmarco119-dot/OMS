-- Award eligibility is independent from base-salary attendance proration.
-- NULL preserves the existing month-specific standard for historical rules.
alter table public.payroll_employee_rules
  add column full_attendance_bonus_days integer check (full_attendance_bonus_days between 1 and 31),
  add column extra_attendance_bonus_days integer check (extra_attendance_bonus_days between 1 and 31);

create or replace function public.admin_save_payroll_employee_rule(
  p_profile_id uuid, p_fields jsonb, p_store_ids uuid[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rule_id uuid;
  v_full integer := nullif(p_fields->>'fullAttendanceBonusDays','')::integer;
  v_extra integer := nullif(p_fields->>'extraAttendanceBonusDays','')::integer;
begin
  if (v_full is not null and v_full not between 1 and 31)
    or (v_extra is not null and v_extra not between 1 and 31) then
    raise exception '奖励出勤标准必须为 1 至 31 的整数天数';
  end if;
  v_rule_id := public.admin_save_payroll_employee_rule_before_performance_override(
    p_profile_id, p_fields - 'performanceOverrideEnabled' - 'performanceOverrideAmount', p_store_ids
  );
  update public.payroll_employee_rules
  set performance_override_enabled = false, performance_override_amount = 0,
      full_attendance_bonus_days = case when p_fields ? 'fullAttendanceBonusDays' then v_full else full_attendance_bonus_days end,
      extra_attendance_bonus_days = case when p_fields ? 'extraAttendanceBonusDays' then v_extra else extra_attendance_bonus_days end
  where id = v_rule_id;
  return v_rule_id;
end;
$$;

-- Patch the original award layers in place (their names changed as wrappers
-- were added). Applying the award before tax/performance/holiday layers keeps
-- every downstream total consistent, without replacing that calculation chain.
do $migration$
declare
  v_proc record;
  v_sql text;
  v_full_count integer := 0;
  v_extra_count integer := 0;
begin
  for v_proc in
    select p.oid, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'calculate_payroll_estimate%'
  loop
    if position('v_awarded := v_enabled and v_full_days > 0 and v_attendance_days >= v_full_days;' in v_proc.prosrc)>0 then
      v_sql := pg_get_functiondef(v_proc.oid);
      if position('v_full_days := coalesce((v_result->>''fullAttendanceDays'')::integer, 0);' in v_sql)=0 then
        raise exception 'Full-attendance award layer does not match expected contract';
      end if;
      v_sql := replace(v_sql,
        'v_full_days := coalesce((v_result->>''fullAttendanceDays'')::integer, 0);',
        'v_full_days := coalesce((select full_attendance_bonus_days from public.payroll_employee_rules where id=v_rule_id), coalesce((v_result->>''fullAttendanceDays'')::integer, 0));');
      v_sql := replace(v_sql,
        'v_awarded := v_enabled and v_full_days > 0 and v_attendance_days >= v_full_days;',
        'v_awarded := v_enabled and v_full_days > 0 and v_attendance_days >= v_full_days;
         v_result := v_result || jsonb_build_object(''fullAttendanceBonusDays'',v_full_days);');
      execute v_sql;
      v_full_count := v_full_count+1;
    end if;
    if position('v_extra_attendance_rate numeric := 300;' in v_proc.prosrc)>0 then
      v_sql := pg_get_functiondef(v_proc.oid);
      if position('v_extra_days := greatest(coalesce((v_result->>''attendanceDays'')::integer,0)-coalesce((v_result->>''fullAttendanceDays'')::integer,0),0);' in v_sql)=0 then
        raise exception 'Extra-attendance award layer does not match expected contract';
      end if;
      v_sql := replace(v_sql,'v_extra_attendance_rate numeric := 300;',
        'v_extra_attendance_rate numeric := 300; v_extra_threshold integer;');
      v_sql := replace(v_sql,
        'v_extra_days := greatest(coalesce((v_result->>''attendanceDays'')::integer,0)-coalesce((v_result->>''fullAttendanceDays'')::integer,0),0);',
        'v_extra_threshold := coalesce((select extra_attendance_bonus_days from public.payroll_employee_rules where id=nullif(v_result->>''ruleId'','''')::uuid),coalesce((v_result->>''fullAttendanceDays'')::integer,0));
         v_extra_days := greatest(coalesce((v_result->>''attendanceDays'')::integer,0)-v_extra_threshold,0);
         v_result := v_result || jsonb_build_object(''extraAttendanceBonusDays'',v_extra_threshold);');
      execute v_sql;
      v_extra_count := v_extra_count+1;
    end if;
  end loop;
  if v_full_count<>1 or v_extra_count<>1 then
    raise exception 'Expected one of each award layer, found %/%',v_full_count,v_extra_count;
  end if;
end;
$migration$;

revoke all on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]) from public, anon;
grant execute on function public.admin_save_payroll_employee_rule(uuid,jsonb,uuid[]) to authenticated;
notify pgrst, 'reload schema';
