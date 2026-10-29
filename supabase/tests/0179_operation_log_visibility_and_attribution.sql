-- Isolated fixtures; rollback leaves all real employee data and logs untouched.
begin;
do $test$
declare
  a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); shop uuid;
  l1 uuid; l2 uuid; l3 uuid; slip uuid; person uuid;
begin
  select id into strict shop from public.stores where is_active order by id limit 1;
  insert into auth.users(id,email) values(a,a||'@log-qa.invalid'),(s,s||'@log-qa.invalid'),(t,t||'@log-qa.invalid');
  insert into public.profiles(id,store_id,username,display_name,role,employment_type)
  values(a,shop,'log-admin-'||a,'日志验证管理员','admin','full_time'),(s,shop,'log-staff-'||s,'日志验证员工','staff','full_time'),(t,shop,'log-staff-'||t,'日志验证员工二','staff','full_time');
  insert into public.profile_store_access(profile_id,store_id) values(a,shop),(s,shop),(t,shop);
  insert into public.admin_store_access(admin_profile_id,store_id) values(a,shop);
  perform set_config('request.jwt.claim.sub',s::text,true);
  l1:=public.record_system_activity('payroll','estimate_detail','2026-09',null,s,'{"scope":"self"}');
  l2:=public.record_system_activity('payroll','estimate_detail','2026-09',null,s,'{"scope":"self"}');
  l3:=public.record_system_activity('payroll','estimate_detail','2026-10',null,s,'{"scope":"self"}');
  if l1<>l2 or l1=l3 then raise exception 'Retry or month deduplication mismatch'; end if;
  if not exists(select 1 from public.system_operation_logs where id=l1 and store_id=shop and actor_id=s and entity_id=s and metadata->>'period'='2026-09') then raise exception 'Employee/store attribution mismatch'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  l1:=public.record_system_activity('payroll','estimate_detail','2026-09',null,s,'{}');
  l2:=public.record_system_activity('payroll','estimate_detail','2026-09',null,t,'{}');
  if l1=l2 then raise exception 'Different employees collapsed'; end if;
  l3:=public.record_system_activity('attendance','month_detail','2026-09',null,s,'{}');
  if not exists(select 1 from public.system_operation_logs where id=l3 and store_id=shop and module='attendance') then raise exception 'Attendance store attribution missing'; end if;
  insert into public.payroll_payslips(profile_id,store_id,payroll_month,estimate_snapshot,status,issue_source,issued_at)
    values(s,shop,'2026-10-01','{}','draft','admin',null) returning id into slip;
  update public.payroll_payslips set status='issued',issued_at=now() where id=slip;
  perform set_config('request.jwt.claim.sub',s::text,true);
  update public.payroll_payslips set status='confirmed',confirmed_at=now() where id=slip;
  if (select count(*) from public.system_operation_logs where entity_type='payroll_payslips' and entity_id=slip)<>3
    or not exists(select 1 from public.system_operation_logs where entity_id=slip and actor_id=s and module='payroll' and store_id=shop and metadata->>'afterStatus'='confirmed') then raise exception 'Payslip lifecycle audit missing or actor mismatch'; end if;
  if exists(select 1 from public.system_operation_logs where entity_id=slip and (metadata ? 'estimate_snapshot' or metadata ? 'salary')) then raise exception 'Salary content leaked into audit'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  insert into public.tax_reporting_people(full_name,id_number,phone,reporting_store_id)
    values('日志验证登记','110101200001010019','13000000000',shop) returning id into person;
  insert into public.tax_reporting_monthly_salaries(person_id,payroll_month,manual_amount)
    values(person,'2026-10-01',1234);
  if (select count(*) from public.system_operation_logs where entity_id=person and module='tax_accounting' and store_id=shop)<>2 then raise exception 'Tax module or store attribution mismatch'; end if;
  raise notice 'Exact retries, months, employee/store attribution, attendance and payslip lifecycle verified';
end $test$;
rollback;
