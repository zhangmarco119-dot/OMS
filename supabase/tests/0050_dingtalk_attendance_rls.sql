begin;

insert into public.stores (id,name,short_name) values
  ('a5000000-0000-4000-8000-000000000001','考勤测试门店甲','测试甲'),
  ('a5000000-0000-4000-8000-000000000002','考勤测试门店乙','测试乙');

insert into auth.users (id,email,aud,role) values
  ('a5100000-0000-4000-8000-000000000001','attendance-staff-a@test.invalid','authenticated','authenticated'),
  ('a5100000-0000-4000-8000-000000000002','attendance-manager-a@test.invalid','authenticated','authenticated'),
  ('a5100000-0000-4000-8000-000000000003','attendance-staff-b@test.invalid','authenticated','authenticated'),
  ('a5100000-0000-4000-8000-000000000004','attendance-admin@test.invalid','authenticated','authenticated');

insert into public.profiles (id,store_id,username,display_name,role) values
  ('a5100000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','attendance_staff_a','考勤员工甲','staff'),
  ('a5100000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','attendance_manager_a','考勤店长甲','manager'),
  ('a5100000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000002','attendance_staff_b','考勤员工乙','staff'),
  ('a5100000-0000-4000-8000-000000000004','a5000000-0000-4000-8000-000000000001','attendance_admin','考勤管理员','admin');

insert into public.profile_store_access (profile_id,store_id) values
  ('a5100000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001'),
  ('a5100000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001'),
  ('a5100000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000002'),
  ('a5100000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000001'),
  ('a5100000-0000-4000-8000-000000000004','a5000000-0000-4000-8000-000000000001');

insert into public.dingtalk_employee_directory (id,corp_id,dingtalk_user_id,display_name) values
  ('a5200000-0000-4000-8000-000000000001','attendance-test-corp','ding-staff-a','考勤员工甲'),
  ('a5200000-0000-4000-8000-000000000002','attendance-test-corp','ding-manager-a','考勤店长甲'),
  ('a5200000-0000-4000-8000-000000000003','attendance-test-corp','ding-staff-b','考勤员工乙');

insert into public.dingtalk_employee_bindings (profile_id,directory_user_id,corp_id,dingtalk_user_id) values
  ('a5100000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','attendance-test-corp','ding-staff-a'),
  ('a5100000-0000-4000-8000-000000000002','a5200000-0000-4000-8000-000000000002','attendance-test-corp','ding-manager-a'),
  ('a5100000-0000-4000-8000-000000000003','a5200000-0000-4000-8000-000000000003','attendance-test-corp','ding-staff-b');

insert into public.attendance_daily_records (corp_id,profile_id,store_id,attendance_date,daily_status,is_attended,actual_on_at,actual_off_at) values
  ('attendance-test-corp','a5100000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','2026-07-14','late',true,'2026-07-14 01:10:00+00','2026-07-14 10:00:00+00'),
  ('attendance-test-corp','a5100000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000001','2026-07-14','normal',true,'2026-07-14 01:00:00+00','2026-07-14 10:00:00+00'),
  ('attendance-test-corp','a5100000-0000-4000-8000-000000000003','a5000000-0000-4000-8000-000000000002','2026-07-14','missing',false,null,null);

-- The same third-party day must update, not duplicate.
insert into public.attendance_daily_records (corp_id,profile_id,store_id,attendance_date,daily_status,is_attended,late_minutes)
values ('attendance-test-corp','a5100000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001','2026-07-14','late',true,10)
on conflict (corp_id,profile_id,attendance_date) do update set late_minutes=excluded.late_minutes;

do $$ begin
  if (select count(*) from public.attendance_daily_records where corp_id='attendance-test-corp' and profile_id='a5100000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'attendance daily upsert is not idempotent';
  end if;
end $$;

set local role authenticated;

select set_config('request.jwt.claim.sub','a5100000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.attendance_daily_records where corp_id='attendance-test-corp') <> 1 then raise exception 'staff can read another employee attendance'; end if;
  if (select count(*) from public.dingtalk_employee_bindings where corp_id='attendance-test-corp') <> 1 then raise exception 'staff can read another employee binding'; end if;
  if (select count(*) from public.dingtalk_employee_directory where corp_id='attendance-test-corp') <> 0 then raise exception 'staff can read DingTalk directory'; end if;
end $$;

select set_config('request.jwt.claim.sub','a5100000-0000-4000-8000-000000000002',true);
do $$ begin
  if (select count(*) from public.attendance_daily_records where corp_id='attendance-test-corp') <> 1 then raise exception 'manager can read store-wide attendance'; end if;
end $$;

select set_config('request.jwt.claim.sub','a5100000-0000-4000-8000-000000000004',true);
do $$ begin
  if (select count(*) from public.attendance_daily_records where corp_id='attendance-test-corp') <> 2 then raise exception 'admin authorized-store attendance scope failed'; end if;
  if exists(select 1 from public.attendance_daily_records where store_id='a5000000-0000-4000-8000-000000000002') then raise exception 'admin can read unauthorized store attendance'; end if;
  if public.can_admin_manage_attendance_profile('a5100000-0000-4000-8000-000000000003') then raise exception 'secondary profile access exposed another store employee'; end if;
  if ((public.admin_attendance_month('2026-07-01',null,'','all',50,0)->>'total')::integer) <> 2 then raise exception 'admin monthly RPC scope failed'; end if;
end $$;

reset role;
rollback;
