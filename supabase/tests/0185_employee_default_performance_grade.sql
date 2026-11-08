begin;
do $test$
declare
 a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid();
 r uuid; result jsonb; before_default jsonb; historical jsonb; snapshot jsonb; saved jsonb; d_coefficient numeric;
begin
 insert into public.stores(id,name,short_name) values(shop,'默认绩效验证-'||shop,'绩效验证');
 insert into auth.users(id,email) values(a,a||'@default-grade.invalid'),(s,s||'@default-grade.invalid'),(other,other||'@default-grade.invalid');
 insert into public.profiles(id,store_id,username,display_name,role,employment_type)
 values(a,shop,'grade-admin-'||a,'验证管理员','admin','full_time'),(s,shop,'grade-staff-'||s,'验证员工','staff','full_time'),(other,shop,'grade-other-'||other,'其他员工','staff','full_time');
 insert into public.profile_store_access(profile_id,store_id) values(a,shop),(s,shop),(other,shop);
 insert into public.admin_store_access(admin_profile_id,store_id) values(a,shop);
 update public.profile_store_assignment_periods set effective_from='2026-10-01',is_primary=true where profile_id in(s,other);
 perform set_config('request.jwt.claim.sub',a::text,true);
 r:=public.admin_save_payroll_employee_rule(s,jsonb_build_object('monthlyBaseSalary',2600,'housingEnabled',false,'performanceEnabled',true,'fullPerformanceAmount',2600,'commissionEnabled',false,'fullAttendanceBonusEnabled',false,'confirmed',true,'effectiveFrom','2026-10-01'),'{}');
 perform public.admin_save_payroll_employee_rule(other,jsonb_build_object('monthlyBaseSalary',2600,'housingEnabled',false,'performanceEnabled',true,'fullPerformanceAmount',2600,'commissionEnabled',false,'fullAttendanceBonusEnabled',false,'confirmed',true,'effectiveFrom','2026-10-01'),'{}');
 insert into public.attendance_daily_records(corp_id,profile_id,store_id,attendance_date,actual_on_at,actual_off_at,on_duty_result,off_duty_result,daily_status,missing_punch)
 select 'default-grade-qa',profile,shop,'2026-11-01','2026-11-01 09:00+08','2026-11-01 19:00+08','normal','normal','normal','none' from unnest(array[s,other]) profile;
 before_default:=public.get_payroll_estimate(s,'2026-11-08');
 perform public.admin_save_payroll_monthly_performance(s,'2026-10-01',jsonb_build_array(jsonb_build_object('storeId',shop,'mode','grade','grade','B')),null);
 historical:=public.get_payroll_estimate(s,'2026-10-31');
 insert into public.payroll_default_performance_settings(profile_id,default_grade,effective_from,updated_by) values(s,'D','2026-11-01',a);
 perform set_config('role','authenticated',true);
 if not exists(select 1 from public.payroll_default_performance_settings where profile_id=s and default_grade='D') then raise exception 'Authorized administrator cannot read default'; end if;
 perform set_config('role','none',true);
 result:=public.get_payroll_estimate(s,'2026-11-08');
 if result->>'performanceGrade'<>'D' or result->'performanceStores'->0->>'calculationMode'<>'grade' then raise exception 'Employee default was not applied'; end if;
 if result->'performanceStores'->0->>'score' is not null then raise exception 'Default grade should not imply a score'; end if;
 if (result->>'accruedPerformance')::numeric is distinct from (result->'performanceStores'->0->>'amount')::numeric then raise exception 'Grade was not reflected in salary'; end if;
 select grade_d_coefficient into d_coefficient from public.payroll_performance_rules where effective_from<='2026-11-08' and (effective_to is null or effective_to>='2026-11-08') order by effective_from desc limit 1;
 if (result->>'accruedPerformance')::numeric<>round(2600*d_coefficient/26,2) then raise exception 'Default grade coefficient or attendance proration incorrect'; end if;
 if public.get_payroll_estimate(other,'2026-11-08')->>'performanceGrade' is distinct from before_default->>'performanceGrade' then raise exception 'Default affected another employee'; end if;
 if private.payroll_default_performance_grade(s,'2026-10-31') is not null then raise exception 'Default changed historical months'; end if;
 if public.get_payroll_estimate(s,'2026-10-31')->>'performanceGrade' is distinct from historical->>'performanceGrade' then raise exception 'Previously set monthly grade was changed'; end if;
 perform public.admin_save_payroll_monthly_performance(s,'2026-11-01',jsonb_build_array(jsonb_build_object('storeId',shop,'mode','grade','grade','B')),null);
 result:=public.get_payroll_estimate(s,'2026-11-08');
 if result->>'performanceGrade'<>'B' then raise exception 'Manual grade was overridden by default'; end if;
 perform public.admin_save_payroll_monthly_performance(s,'2026-11-01',jsonb_build_array(jsonb_build_object('storeId',shop,'mode','score','score',95)),null);
 result:=public.get_payroll_estimate(s,'2026-11-08');
 if (result->>'performanceScore')::numeric<>95 or result->'performanceStores'->0->>'calculationMode'<>'score' then raise exception 'Manual score was overridden by default'; end if;
 perform public.admin_save_payroll_monthly_performance(s,'2026-11-01',jsonb_build_array(jsonb_build_object('storeId',shop,'mode','automatic')),null);
 result:=public.get_payroll_estimate(s,'2026-11-08');
 if result->'performanceStores'->0->>'calculationMode'<>'automatic' or (result->>'performanceScore') is null then raise exception 'Explicit automatic mode did not persist'; end if;
 if not exists(select 1 from public.payroll_store_performance_overrides where profile_id=s and payroll_month='2026-11-01' and override_mode='automatic') then raise exception 'Automatic monthly choice was not saved'; end if;
 if private.payroll_default_performance_grade(s,'2026-12-01')<>'D' or exists(select 1 from public.payroll_store_performance_overrides where profile_id=s and payroll_month='2026-12-01') then raise exception 'Next month did not return to the default'; end if;
 saved:=public.admin_generate_payroll_payslips('2026-11-01',array[s]);
 select estimate_snapshot into snapshot from public.payroll_payslips where profile_id=s and payroll_month='2026-11-01';
 update public.payroll_default_performance_settings set default_grade='C' where profile_id=s;
 if (select estimate_snapshot from public.payroll_payslips where profile_id=s and payroll_month='2026-11-01') is distinct from snapshot then raise exception 'Default setting rewrote an existing payslip'; end if;
 perform set_config('request.jwt.claim.sub',s::text,true);
 perform set_config('role','authenticated',true);
 if exists(select 1 from public.payroll_default_performance_settings where profile_id=s) then raise exception 'Employee can directly read administrator default'; end if;
 perform set_config('role','none',true);
 raise notice 'Default grade, independent months, explicit grade/score/automatic, history, isolation and snapshot protection verified';
end $test$;
rollback;
