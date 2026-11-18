begin;
do $test$
declare a uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); shop uuid:=gen_random_uuid(); penalty uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid();
begin
 insert into public.stores(id,name,short_name) values(shop,'罚单图片权限验证-'||shop,'测试');
 insert into auth.users(id,email) values(a,a||'@penalty-image.invalid'),(m,m||'@penalty-image.invalid'),(s,s||'@penalty-image.invalid'),(other,other||'@penalty-image.invalid');
 insert into public.profiles(id,store_id,username,display_name,role,employment_type) values
 (a,shop,'image-admin-'||a,'管理员','admin','full_time'),(m,shop,'image-manager-'||m,'店长','manager','full_time'),(s,shop,'image-staff-'||s,'员工','staff','full_time'),(other,shop,'image-other-'||other,'其他员工','staff','full_time');
 insert into public.payroll_penalties(id,profile_id,event_date,reason,amount,event_level,created_by) values(penalty,s,current_date,'权限验证',0,'reminder',m);
 insert into public.payroll_penalty_assets(id,penalty_id,object_path,file_name,mime_type,size_bytes,uploaded_by) values(asset,penalty,m||'/penalty/'||penalty||'/photo.jpg','photo.jpg','image/jpeg',123,m);
 perform set_config('request.jwt.claim.sub',s::text,true); perform set_config('role','authenticated',true);
 if not exists(select 1 from public.payroll_penalty_assets where id=asset) then raise exception 'Employee cannot read own penalty image metadata'; end if;
 if not public.can_read_payroll_evidence(m||'/penalty/'||penalty||'/photo.jpg') then raise exception 'Employee cannot read own image file'; end if;
 perform set_config('request.jwt.claim.sub',other::text,true);
 if exists(select 1 from public.payroll_penalty_assets where id=asset) then raise exception 'Another employee can read private image metadata'; end if;
 if public.can_read_payroll_evidence(m||'/penalty/'||penalty||'/photo.jpg') then raise exception 'Another employee can read private image file'; end if;
 perform set_config('request.jwt.claim.sub',m::text,true);
 if not exists(select 1 from public.payroll_penalty_assets where id=asset) then raise exception 'Uploader cannot read their own image'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 if not exists(select 1 from public.payroll_penalty_assets where id=asset) then raise exception 'Admin cannot read image'; end if;
 perform set_config('role','none',true);
 raise notice 'Penalty image access: employee, uploader, administrator and other employee verified';
end $test$;
rollback;
