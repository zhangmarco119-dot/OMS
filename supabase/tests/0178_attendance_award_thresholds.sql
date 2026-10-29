-- Transaction-only fixtures: never alter an employee's records or payslips.
begin;
do $test$
declare
  v_admin uuid := gen_random_uuid(); v_staff uuid := gen_random_uuid(); v_store uuid;
  v_rule uuid; v_old jsonb; v_new jsonb; v_day integer; v_fields jsonb;
begin
  select id into strict v_store from public.stores where is_active order by id limit 1;
  insert into auth.users(id,email) values(v_admin,v_admin::text||'@award-qa.invalid'),(v_staff,v_staff::text||'@award-qa.invalid');
  insert into public.profiles(id,store_id,username,display_name,role,employment_type)
    values(v_admin,v_store,'award-admin-'||v_admin::text,'奖励标准验证管理员','admin','full_time'),
          (v_staff,v_store,'award-staff-'||v_staff::text,'奖励标准验证员工','staff','full_time');
  insert into public.profile_store_access(profile_id,store_id) values(v_admin,v_store),(v_staff,v_store);
  insert into public.admin_store_access(admin_profile_id,store_id) values(v_admin,v_store);
  update public.profile_store_assignment_periods set effective_from='2026-10-01',is_primary=true where profile_id in(v_admin,v_staff);
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v_fields:=jsonb_build_object('monthlyBaseSalary',2700,'housingEnabled',false,'performanceEnabled',false,'commissionEnabled',false,
    'fullAttendanceBonusEnabled',true,'fullAttendanceBonusAmount',500,'confirmed',true,'effectiveFrom','2026-10-01');
  v_rule:=public.admin_save_payroll_employee_rule_v2(v_staff,v_fields,array[v_store],'[]'::jsonb);
  for v_day in 1..5 loop
    insert into public.attendance_daily_records(corp_id,profile_id,store_id,attendance_date,planned_on_at,planned_off_at,actual_on_at,actual_off_at,on_duty_result,off_duty_result,daily_status,missing_punch)
    values('award-qa',v_staff,v_store,make_date(2026,10,v_day),make_date(2026,10,v_day)+time '09:00',make_date(2026,10,v_day)+time '19:00',make_date(2026,10,v_day)+time '09:00',make_date(2026,10,v_day)+time '19:00','normal','normal','normal','none');
  end loop;
  v_old:=public.get_payroll_estimate(v_staff,'2026-10-05');
  v_rule:=public.admin_save_payroll_employee_rule_v2(v_staff,v_fields||jsonb_build_object('fullAttendanceBonusDays',2,'extraAttendanceBonusDays',3),array[v_store],'[]'::jsonb);
  for v_day in 1..5 loop
    v_new:=public.get_payroll_estimate(v_staff,make_date(2026,10,v_day));
    if (v_new->>'attendanceDays')::int<>v_day
      or (v_new->>'accruedFullAttendanceBonus')::numeric<>(case when v_day>=2 then 500 else 0 end)
      or (v_new->>'accruedExtraAttendanceBonus')::numeric<>greatest(v_day-3,0)*300
      or (v_new->>'fullAttendanceBonusDays')::int<>2 or (v_new->>'extraAttendanceBonusDays')::int<>3 then
      raise exception 'Award boundary mismatch on attendance day %',v_day;
    end if;
  end loop;
  if v_new->>'fullAttendanceDays'<>v_old->>'fullAttendanceDays'
    or v_new->>'accruedBaseSalary'<>v_old->>'accruedBaseSalary'
    or (v_new->>'incomeSubtotalKnown')::numeric-(v_old->>'incomeSubtotalKnown')::numeric<>1100
    or (v_new->>'knownEstimatedPayable')::numeric-(v_old->>'knownEstimatedPayable')::numeric<>1100 then
    raise exception 'Award thresholds changed proration or failed to reach total income';
  end if;
  begin
    perform public.admin_save_payroll_employee_rule_v2(v_staff,v_fields||jsonb_build_object('fullAttendanceBonusDays',0),array[v_store],'[]'::jsonb);
    raise exception 'Invalid threshold accepted' using errcode='23514';
  exception when raise_exception then null;
  end;
  update public.profiles set employment_type='part_time' where id=v_staff;
  v_new:=public.get_payroll_estimate(v_staff,'2026-10-05');
  if (v_new->>'accruedFullAttendanceBonus')::numeric<>0 or (v_new->>'accruedExtraAttendanceBonus')::numeric<>0 then
    raise exception 'Attendance awards leaked into part-time payroll';
  end if;
  raise notice 'Award boundaries, total income, independent proration, validation and part-time exclusion verified';
end;
$test$;
rollback;
