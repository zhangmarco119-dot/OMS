begin;
do $test$
declare admin_id uuid:=gen_random_uuid(); staff_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); other_shop uuid:=gen_random_uuid(); own_penalty uuid:=gen_random_uuid(); other_penalty uuid:=gen_random_uuid(); affected integer;
begin
 insert into public.stores(id,name,short_name) values(shop,'罚单历史权限-'||shop,'测试'),(other_shop,'另一门店-'||other_shop,'测试');
 insert into auth.users(id,email) values(admin_id,admin_id||'@penalty-history.invalid'),(staff_id,staff_id||'@penalty-history.invalid'),(other_id,other_id||'@penalty-history.invalid');
 insert into public.profiles(id,store_id,username,display_name,role,employment_type,is_active) values
 (admin_id,shop,'history-admin-'||admin_id,'管理员','admin','full_time',true),
 (staff_id,shop,'history-staff-'||staff_id,'已离职员工','staff','full_time',false),
 (other_id,other_shop,'history-other-'||other_id,'另一门店员工','staff','full_time',false);
 insert into public.admin_store_access(admin_profile_id,store_id) values(admin_id,shop);
 insert into public.profile_store_access(profile_id,store_id) values(admin_id,shop);
 insert into public.payroll_penalties(id,profile_id,event_date,reason,amount,event_level,created_by) values
 (own_penalty,staff_id,current_date,'历史测试',0,'reminder',admin_id),(other_penalty,other_id,current_date,'另一门店测试',0,'reminder',admin_id);
 perform set_config('request.jwt.claim.sub',admin_id::text,true); perform set_config('role','authenticated',true);
 if not exists(select 1 from public.payroll_penalties where id=own_penalty) then raise exception 'Admin cannot read own store inactive employee history'; end if;
 if exists(select 1 from public.payroll_penalties where id=other_penalty) then raise exception 'Admin can read another store inactive employee history'; end if;
 update public.payroll_penalties set reason='不应修改' where id=own_penalty;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Read-only inactive history grants write access'; end if;
 perform set_config('role','none',true);
 raise notice 'Inactive penalty history: scoped read and write isolation verified';
end $test$;
rollback;
