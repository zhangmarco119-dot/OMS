-- Cloud integration regression. Run against an environment containing the
-- restored employee/holiday attendance fixture; all changes roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and is_active and deleted_at is null order by created_at limit 1),true);
select set_config('request.jwt.claim.role','authenticated',true);
do $test$
declare
  v_profile uuid;
  v_month date;
  v_date date;
  v_old numeric;
  v_before jsonb;
  v_after jsonb;
begin
  select daily.profile_id,date_trunc('month',daily.attendance_date)::date,
    least((date_trunc('month',daily.attendance_date)+interval '1 month - 1 day')::date,(now() at time zone 'Asia/Shanghai')::date)
  into v_profile,v_month,v_date
  from public.attendance_daily_records daily
  join private.payroll_statutory_holidays holiday on holiday.holiday_date=daily.attendance_date
  join public.profiles profile on profile.id=daily.profile_id
  where daily.is_attended and profile.is_active and profile.deleted_at is null
  order by daily.attendance_date desc limit 1;
  if v_profile is null then raise exception 'Holiday attendance fixture required'; end if;
  v_before := public.get_payroll_estimate(v_profile,v_date);
  select coalesce(amount,0) into v_old from private.payroll_holiday_subsidies where profile_id=v_profile and payroll_month=v_month;
  v_old := coalesce(v_old,0);
  insert into private.payroll_holiday_subsidies(profile_id,payroll_month,amount)
  values(v_profile,v_month,v_old+123)
  on conflict(profile_id,payroll_month) do update set amount=excluded.amount;
  v_after := public.get_payroll_estimate(v_profile,v_date);
  if (v_after->>'holidaySubsidy')::numeric - coalesce((v_before->>'holidaySubsidy')::numeric,0) <> 123
     or (v_after->>'knownEstimatedPayable')::numeric - (v_before->>'knownEstimatedPayable')::numeric <> 123 then
    raise exception 'Dated performance bypassed holiday subsidy in payroll totals';
  end if;
  if not (v_after ? 'departureMonthExcluded') then raise exception 'Departure-month policy was bypassed'; end if;
  if has_function_privilege('authenticated','public.payroll_performance_store_scope(uuid,uuid,date)','execute')
     or has_table_privilege('authenticated','public.profile_store_assignment_periods','insert,update,delete') then
    raise exception 'Dated payroll metadata must not allow direct client writes';
  end if;
  raise notice 'Holiday subsidy totals, departure policy and membership write restrictions passed';
end $test$;
rollback;
