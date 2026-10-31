begin;
do $test$
declare
  a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); other_shop uuid:=gen_random_uuid();
  r uuid; integration uuid; before_close jsonb; historical jsonb; after_close jsonb; whole_closed jsonb;
begin
  insert into public.stores(id,name,short_name) values(shop,'关店验证-'||shop,'关店验证'),(other_shop,'营业验证-'||other_shop,'营业验证');
  insert into auth.users(id,email) values(a,a||'@closure-qa.invalid'),(s,s||'@closure-qa.invalid');
  insert into public.profiles(id,store_id,username,display_name,role,employment_type)
    values(a,shop,'closure-admin-'||a,'验证管理员','admin','full_time'),(s,shop,'closure-staff-'||s,'验证员工','staff','full_time');
  insert into public.profile_store_access(profile_id,store_id) values(a,shop),(a,other_shop),(s,shop);
  insert into public.admin_store_access(admin_profile_id,store_id) values(a,shop),(a,other_shop);
  update public.profile_store_assignment_periods set effective_from='2026-10-01',is_primary=true where profile_id=s;
  perform set_config('request.jwt.claim.sub',a::text,true);
  r:=public.admin_save_payroll_employee_rule_v2(s,jsonb_build_object('monthlyBaseSalary',2700,'housingEnabled',false,'performanceEnabled',true,'fullPerformanceAmount',270,'commissionEnabled',true,'commissionRate',0.01,'fullAttendanceBonusEnabled',false,'confirmed',true,'effectiveFrom','2026-10-01'),array[shop],jsonb_build_array(jsonb_build_object('storeId',shop,'allocationRatio',1)));
  insert into public.attendance_daily_records(corp_id,profile_id,store_id,attendance_date,actual_on_at,actual_off_at,on_duty_result,off_duty_result,daily_status,missing_punch)
    select 'closure-qa',s,shop,d,d+time '09:00',d+time '19:00','normal','normal','normal','none' from unnest(array['2026-10-01'::date,'2026-10-14'::date,'2026-10-15'::date,'2026-10-20'::date]) d;
  insert into public.payroll_store_revenues(store_id,revenue_date,confirmed_amount,updated_by)
    values(shop,'2026-10-14',100,a),(shop,'2026-10-15',999,a);
  before_close:=public.get_payroll_estimate(s,'2026-10-14');
  insert into public.pos_sales_integrations(store_id,provider,display_name,enabled,configured_by) values(shop,'pospal','关店同步验证',true,a) returning id into integration;
  perform public.admin_set_store_operating(shop,false,'2026-10-15');
  if (select enabled from public.pos_sales_integrations where id=integration) then raise exception 'Automatic sales sync still enabled'; end if;
  begin
    update public.pos_sales_integrations set enabled=true where id=integration;
    raise exception 'Closed integration was re-enabled' using errcode='23514';
  exception when raise_exception then null;
  end;
  if public.store_is_operating_on(shop,'2026-10-15') or not public.store_is_operating_on(shop,'2026-10-14') or not public.store_is_operating_on(other_shop,'2026-10-20') then raise exception 'Date boundary or other-store isolation mismatch'; end if;
  historical:=public.get_payroll_estimate(s,'2026-10-14');
  if historical->>'accruedPerformance' is distinct from before_close->>'accruedPerformance' or historical->>'accruedCommission' is distinct from before_close->>'accruedCommission' then raise exception 'Closure changed earlier payroll'; end if;
  after_close:=public.get_payroll_estimate(s,'2026-10-20');
  if (after_close->>'revenueTotal')::numeric<>100 or (after_close->>'accruedCommission')::numeric<>1 then raise exception 'Closed-date revenue included: %',after_close->>'revenueTotal'; end if;
  if (after_close->>'attendanceDays')::int<>4 or (after_close->>'accruedBaseSalary')::numeric<>400 then raise exception 'Closure changed base salary/attendance'; end if;
  if (after_close->>'accruedPerformance')::numeric<>(historical->>'accruedPerformance')::numeric then raise exception 'Performance accrued after closure: % vs %',after_close->>'accruedPerformance',historical->>'accruedPerformance'; end if;
  perform public.admin_set_store_operating(shop,false,'2026-10-01');
  whole_closed:=public.get_payroll_estimate(s,'2026-10-20');
  if (whole_closed->>'dataComplete')::boolean is not true then raise exception 'Closed month is incomplete: %',whole_closed->'dataIssues'; end if;
  if (whole_closed->>'accruedPerformance')::numeric<>0 or (whole_closed->>'accruedCommission')::numeric<>0 or (whole_closed->>'performanceReady')::boolean is not true or (whole_closed->>'commissionReady')::boolean is not true then raise exception 'Full closed month still needs performance/revenue: %',whole_closed; end if;
  perform public.admin_set_store_operating(shop,true,'2026-10-21');
  if not (select enabled from public.pos_sales_integrations where id=integration) then raise exception 'Sync did not resume with operating state'; end if;
  if public.store_is_operating_on(shop,'2026-10-20') or not public.store_is_operating_on(shop,'2026-10-21') then raise exception 'Reopening lost closed history'; end if;
  perform set_config('request.jwt.claim.sub',s::text,true);
  begin
    perform public.admin_set_store_operating(shop,false,'2026-10-25');
    raise exception 'Employee changed store state' using errcode='23514';
  exception when insufficient_privilege then null;
  end;
  raise notice 'Closure boundaries, history, reopening, permissions, commission, performance and base salary verified';
end $test$;
rollback;
