begin;
do $test$
declare a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); part uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); result jsonb; slip public.payroll_payslips; frozen jsonb; notice_time timestamptz;
begin
 insert into public.stores(id,name,short_name) values(shop,'零薪资验证-'||shop,'零薪资验证');
 insert into auth.users(id,email) values(a,a||'@zero-payroll.invalid'),(s,s||'@zero-payroll.invalid'),(part,part||'@zero-payroll.invalid');
 insert into public.profiles(id,store_id,username,display_name,role,employment_type)
 values(a,shop,'zero-admin-'||a,'验证管理员','admin','full_time'),(s,shop,'zero-staff-'||s,'验证员工','staff','full_time'),(part,shop,'zero-part-'||part,'验证兼职','staff','part_time');
 insert into public.profile_store_access(profile_id,store_id) values(a,shop),(s,shop),(part,shop);
 insert into public.admin_store_access(admin_profile_id,store_id) values(a,shop);
 update public.profile_store_assignment_periods set effective_from='2026-09-01' where profile_id in(s,part);
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.admin_save_payroll_employee_rule_v2(s,jsonb_build_object('monthlyBaseSalary',5000,'housingEnabled',false,'performanceEnabled',false,'commissionEnabled',false,'fullAttendanceBonusEnabled',false,'confirmed',true,'effectiveFrom','2026-09-01'),'{}','[]');
 result:=public.admin_generate_payroll_payslips('2026-10-01',array[s,part]);
 if (result->>'skippedZeroCount')::integer<>2 or (result->>'generatedCount')::integer<>0 or (result->>'missingTaxCount')::integer<>0 then raise exception 'All-zero generation did not skip cleanly: %',result; end if;
 if exists(select 1 from public.payroll_payslips where profile_id in(s,part)) then raise exception 'Zero statement persisted'; end if;
 result:=public.issue_payroll_payslips_internal('2026-10-01',array[s,part],'scheduled',null);
 if (result->>'skippedZeroCount')::integer<>2 or (result->>'issuedCount')::integer<>0 then raise exception 'Scheduled generation did not skip zeros'; end if;
 if exists(select 1 from public.notifications where recipient_user_id in(s,part)) then raise exception 'Zero statement created a notification'; end if;
 perform public.admin_save_payroll_custom_items(s,'2026-10-01','[{"name":"临时补贴","amount":100}]');
 result:=public.admin_generate_payroll_payslips('2026-10-01',array[s,part]);
 if (result->>'generatedCount')::integer<>1 or (result->>'skippedZeroCount')::integer<>1 then raise exception 'Mixed zero/positive payroll batch mismatch'; end if;
 select * into slip from public.payroll_payslips where profile_id=s and payroll_month='2026-10-01';
 perform public.admin_save_payroll_custom_items(s,'2026-10-01','[]');
 result:=public.admin_generate_payroll_payslips('2026-10-01',array[s]);
 if (result->>'skippedZeroCount')::integer<>1 or (select status from public.payroll_payslips where id=slip.id)<>'withdrawn' then raise exception 'Obsolete positive draft remains sendable'; end if;
 -- A very small positive amount must not be rounded down or skipped.
 perform public.admin_save_payroll_custom_items(s,'2026-10-01','[{"name":"补贴","amount":0.01}]');
 result:=public.admin_generate_payroll_payslips('2026-10-01',array[s]);
 if (result->>'refreshedCount')::integer<>1 or (result->>'skippedZeroCount')::integer<>0 then raise exception 'Positive one-cent payroll was skipped'; end if;
 result:=public.issue_payroll_payslips_internal('2026-10-01',array[s],'scheduled',null);
 if (result->>'refreshedCount')::integer<>1 then raise exception 'Positive scheduled statement did not issue'; end if;
 select estimate_snapshot into frozen from public.payroll_payslips where id=slip.id;
 select created_at into notice_time from public.notifications where recipient_user_id=s and entity_id=slip.id;
 perform public.admin_save_payroll_custom_items(s,'2026-10-01','[]');
 result:=public.admin_generate_payroll_payslips('2026-10-01',array[s]);
 if (result->>'skippedSentCount')::integer<>1 then raise exception 'Issued statement was not protected'; end if;
 result:=public.issue_payroll_payslips_internal('2026-10-01',array[s],'scheduled',null);
 if (result->>'skippedZeroCount')::integer<>1 or (select estimate_snapshot from public.payroll_payslips where id=slip.id)<>frozen or (select status from public.payroll_payslips where id=slip.id)<>'issued' then raise exception 'Zero regeneration changed issued history'; end if;
 if (select created_at from public.notifications where recipient_user_id=s and entity_id=slip.id) is distinct from notice_time then raise exception 'Skipped statement notified again'; end if;
 if private.payroll_snapshot_is_zero('{"dataComplete":true,"incomeSubtotalKnown":100,"knownEstimatedPayable":0,"estimatedPayable":0,"individualIncomeTax":100}') then raise exception 'Zero net pay with positive income was skipped'; end if;
 if private.payroll_snapshot_is_zero('{"dataComplete":false,"incomeSubtotalKnown":0,"knownEstimatedPayable":0,"estimatedPayable":null}') is true then raise exception 'Pending salary mistaken for zero'; end if;
 raise notice 'Zero full/part-time salaries, mixed batch, scheduled issue, stale draft, one-cent income and issued history verified';
end $test$;
rollback;
