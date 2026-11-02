begin;
do $test$
declare
 a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); r uuid;
 result jsonb; before_items jsonb; slip public.payroll_payslips; item_id uuid:=gen_random_uuid(); saved jsonb; original_snapshot jsonb;
begin
 insert into public.stores(id,name,short_name) values(shop,'薪资验证-'||shop,'薪资验证');
 insert into auth.users(id,email) values(a,a||'@payroll-qa.invalid'),(s,s||'@payroll-qa.invalid');
 insert into public.profiles(id,store_id,username,display_name,role,employment_type)
 values(a,shop,'payroll-admin-'||a,'验证管理员','admin','full_time'),(s,shop,'payroll-staff-'||s,'验证员工','staff','full_time');
 insert into public.profile_store_access(profile_id,store_id) values(a,shop),(s,shop);
 insert into public.admin_store_access(admin_profile_id,store_id) values(a,shop);
 update public.profile_store_assignment_periods set effective_from='2026-09-01',is_primary=true where profile_id=s;
 perform set_config('request.jwt.claim.sub',a::text,true);
 r:=public.admin_save_payroll_employee_rule_v2(s,jsonb_build_object('monthlyBaseSalary',5000,'housingEnabled',false,'performanceEnabled',false,'commissionEnabled',true,'commissionRate',0.01,'fullAttendanceBonusEnabled',false,'confirmed',true,'effectiveFrom','2026-09-01'),array[shop],'[]');
 insert into public.attendance_daily_records(corp_id,profile_id,store_id,attendance_date,actual_on_at,actual_off_at,on_duty_result,off_duty_result,daily_status,missing_punch)
 select 'payroll-qa',s,shop,d,d+time '09:00',d+time '19:00','normal','normal','normal','none' from unnest(array['2026-10-01'::date,'2026-10-02','2026-10-03','2026-10-04']) d;
 insert into public.payroll_store_revenues(store_id,revenue_date,confirmed_amount,updated_by) values(shop,'2026-10-01',27000,a);
 -- A previous unrelated statement edit could have stored a zero placeholder.
 insert into private.payroll_holiday_subsidies(profile_id,payroll_month,amount) values(s,'2026-10-01',0);
 result:=public.get_payroll_estimate(s,'2026-10-31');
 if (result->>'holidaySubsidy')::numeric<>244.44 or jsonb_array_length(result->'holidayAttendanceDates')<>3 then raise exception 'October subsidy/dates mismatch: %',result->'holidaySubsidy'; end if;
 if (result->>'payrollStandardDays')::integer<>27 or (result->>'accruedCommission')::numeric<>40 then raise exception 'Commission not prorated by 4/27: %',result->'accruedCommission'; end if;
 if (public.get_payroll_estimate(s,'2026-10-01')->>'holidaySubsidy')::numeric<>81.48 then raise exception 'Cutoff includes future attendance'; end if;
 if (public.get_payroll_estimate(s,'2026-11-02')->>'holidaySubsidy')::numeric<>0 then raise exception 'No-holiday month has subsidy'; end if;
 before_items:=result;
 saved:=public.admin_save_payroll_custom_items(s,'2026-10-01',jsonb_build_array(jsonb_build_object('id',item_id,'name','另外奖励','amount',123.45),jsonb_build_object('name','另外补贴','amount',200)));
 result:=public.get_payroll_estimate(s,'2026-10-31');
 if (result->>'customItemsTotal')::numeric<>323.45 or (result->>'incomeSubtotalKnown')::numeric-(before_items->>'incomeSubtotalKnown')::numeric<>323.45 then raise exception 'Custom items missing or counted twice'; end if;
 if jsonb_array_length(public.get_payroll_estimate(s,'2026-11-02')->'customItems')<>0 then raise exception 'Custom items leaked into another month'; end if;
 perform public.admin_save_payroll_custom_items(s,'2026-10-01','[{"name":"税前奖励验证","amount":6000}]');
 result:=public.get_payroll_estimate(s,'2026-10-31');
 if (result->>'estimatedIndividualIncomeTax')::numeric<=0 or (result->>'knownEstimatedNetPayable')::numeric<>(result->>'knownEstimatedPayable')::numeric-(result->>'estimatedIndividualIncomeTax')::numeric then raise exception 'Monthly additions bypassed estimated tax'; end if;
 perform public.admin_save_payroll_custom_items(s,'2026-10-01',saved);
 perform public.admin_generate_payroll_payslips('2026-10-01',array[s]);
 select * into slip from public.payroll_payslips where profile_id=s and payroll_month='2026-10-01';
 if (slip.estimate_snapshot->>'holidaySubsidy')::numeric<>244.44 or slip.estimate_snapshot->'customItems'<>saved then raise exception 'Snapshot trigger lost calculated amounts'; end if;
 original_snapshot:=slip.estimate_snapshot;
 perform public.admin_save_payroll_custom_items(s,'2026-10-01','[]');
 if (select estimate_snapshot from public.payroll_payslips where id=slip.id)<>original_snapshot then raise exception 'Monthly save rewrote frozen statement'; end if;
 -- Editing snapshot additions also saves monthly additions, exactly once.
 perform public.admin_update_payroll_payslip(slip.id,original_snapshot||jsonb_build_object('customItems',saved));
 select * into slip from public.payroll_payslips where id=slip.id;
 if (slip.estimate_snapshot->>'incomeSubtotalKnown')::numeric<>(original_snapshot->>'incomeSubtotalKnown')::numeric then raise exception 'Edited statement totals diverged'; end if;
 perform public.admin_update_payroll_payslip(slip.id,slip.estimate_snapshot||jsonb_build_object('customItems',saved));
 if (select (estimate_snapshot->>'incomeSubtotalKnown')::numeric from public.payroll_payslips where id=slip.id)<>(original_snapshot->>'incomeSubtotalKnown')::numeric then raise exception 'Repeated edit duplicated additions'; end if;
 if (select calculation_mode from private.payroll_holiday_subsidies where profile_id=s and payroll_month='2026-10-01')<>'automatic' then raise exception 'Unchanged edit froze automatic subsidy'; end if;
 -- Month-end result uses eligible days once for probation, never squared.
 update public.payroll_employee_rules set regularization_date='2026-10-03' where id=r;
 result:=public.get_payroll_estimate(s,'2026-10-31');
 if (result->>'accruedCommission')::numeric<>20 then raise exception 'Probation eligibility applied incorrectly: %',result->'accruedCommission'; end if;
 insert into public.payroll_employee_departure_months(profile_id,payroll_month,updated_by) values(s,'2026-10-01',a);
 if (public.get_payroll_estimate(s,'2026-10-31')->>'accruedCommission')::numeric<>0 then raise exception 'Departure commission exclusion bypassed'; end if;
 begin
  perform public.admin_save_payroll_custom_items(s,'2026-10-01','[{"name":" ","amount":10}]');
  raise exception 'Accepted empty name' using errcode='23514';
 exception when raise_exception then null; end;
 begin
  perform public.admin_save_payroll_custom_items(s,'2026-10-01','[{"name":"奖","amount":-1}]');
  raise exception 'Accepted negative amount' using errcode='23514';
 exception when raise_exception then null; end;
 perform set_config('request.jwt.claim.sub',s::text,true);
 begin
  perform public.admin_save_payroll_custom_items(s,'2026-10-01','[]');
  raise exception 'Employee edited custom payroll' using errcode='23514';
 exception when insufficient_privilege then null; end;
 raise notice 'October dates, proration, tax input, monthly additions, snapshot edits, probation, departure and permissions verified';
end $test$;
rollback;
