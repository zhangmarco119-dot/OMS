alter table public.payroll_payslips drop constraint if exists payroll_payslips_status_check;
alter table public.payroll_payslips drop constraint if exists payroll_payslips_check;
alter table public.payroll_payslips alter column issued_at drop not null;
alter table public.payroll_payslips
  add column admin_note text not null default '',
  add column revision integer not null default 1 check (revision > 0),
  add column last_modified_by uuid references public.profiles(id) on delete set null,
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references public.profiles(id) on delete set null;

alter table public.payroll_payslips
  add constraint payroll_payslips_status_check check (status in ('draft','issued','confirmed','withdrawn')),
  add constraint payroll_payslips_state_dates_check check (
    (status='draft' and issued_at is null and confirmed_at is null and withdrawn_at is null)
    or (status='issued' and issued_at is not null and confirmed_at is null and withdrawn_at is null)
    or (status='confirmed' and issued_at is not null and confirmed_at is not null and withdrawn_at is null)
    or (status='withdrawn' and withdrawn_at is not null)
  );

drop policy if exists payroll_payslips_select on public.payroll_payslips;
create policy payroll_payslips_select on public.payroll_payslips
for select to authenticated using (
  (profile_id=auth.uid() and status in ('issued','confirmed'))
  or (public.current_user_role()='admin' and public.can_admin_manage_attendance_profile(profile_id))
);

create function public.admin_generate_payroll_payslips(
  p_payroll_month date,
  p_profile_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_month date := date_trunc('month',p_payroll_month)::date;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_as_of date;
  v_profile public.profiles;
  v_snapshot jsonb;
  v_existing public.payroll_payslips;
  v_generated integer := 0;
  v_refreshed integer := 0;
  v_skipped integer := 0;
begin
  if public.current_user_role()<>'admin' then raise exception '需要管理员权限'; end if;
  if v_month>date_trunc('month',v_today)::date then raise exception '不能生成未来月份的工资单'; end if;
  v_as_of := case when v_month=date_trunc('month',v_today)::date then v_today else (v_month+interval '1 month - 1 day')::date end;

  for v_profile in
    select profile.* from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and public.can_admin_manage_attendance_profile(profile.id)
      and (coalesce(cardinality(p_profile_ids),0)=0 or profile.id=any(p_profile_ids))
    order by profile.display_name
  loop
    select * into v_existing from public.payroll_payslips
    where profile_id=v_profile.id and payroll_month=v_month for update;
    if v_existing.id is not null and v_existing.status in ('issued','confirmed') then
      v_skipped := v_skipped+1;
      continue;
    end if;
    v_snapshot := public.get_payroll_estimate(v_profile.id,v_as_of);
    if v_existing.id is null then
      insert into public.payroll_payslips(
        profile_id,store_id,payroll_month,estimate_snapshot,status,issue_source,issued_at,issued_by,last_modified_by
      ) values (
        v_profile.id,nullif(v_snapshot->>'primaryStoreId','')::uuid,v_month,v_snapshot,'draft','admin',null,null,auth.uid()
      );
      v_generated := v_generated+1;
    else
      update public.payroll_payslips set
        store_id=nullif(v_snapshot->>'primaryStoreId','')::uuid,
        estimate_snapshot=v_snapshot,
        status='draft',issue_source='admin',issued_at=null,issued_by=null,confirmed_at=null,admin_note='',
        withdrawn_at=null,withdrawn_by=null,last_modified_by=auth.uid(),revision=revision+1
      where id=v_existing.id;
      v_refreshed := v_refreshed+1;
    end if;
  end loop;
  if v_generated+v_refreshed+v_skipped=0 then raise exception '没有可生成工资单的员工'; end if;
  return jsonb_build_object('generatedCount',v_generated,'refreshedCount',v_refreshed,'skippedSentCount',v_skipped,'month',v_month,'asOf',v_as_of);
end;
$$;

create function public.admin_send_payroll_payslip(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.payroll_payslips; v_profile public.profiles;
begin
  select * into v_row from public.payroll_payslips where id=p_payslip_id for update;
  if v_row.id is null or public.current_user_role()<>'admin' or not public.can_admin_manage_attendance_profile(v_row.profile_id) then raise exception '没有该工资单的操作权限'; end if;
  if v_row.status<>'draft' then raise exception '只有待发送工资单可以发送'; end if;
  update public.payroll_payslips set status='issued',issued_at=now(),issued_by=auth.uid(),withdrawn_at=null,withdrawn_by=null
  where id=v_row.id returning * into v_row;
  select * into v_profile from public.profiles where id=v_row.profile_id;
  insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
  values(v_row.profile_id,v_row.store_id,'payroll_payslip_issued',to_char(v_row.payroll_month,'YYYY年MM月')||'工资单已发放','请核对工资单内容，并在“我的薪资”中确认。','payroll_payslip',v_row.id,'payroll-payslip:'||v_row.profile_id||':'||v_row.payroll_month::text)
  on conflict(dedupe_key) do update set title=excluded.title,body=excluded.body,entity_id=excluded.entity_id,is_read=false,read_at=null,created_at=now();
  return to_jsonb(v_row)||jsonb_build_object('displayName',v_profile.display_name);
end;
$$;

create function public.admin_update_payroll_payslip(p_payslip_id uuid,p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.payroll_payslips;
  v_base numeric := coalesce((p_fields->>'accruedBaseSalary')::numeric,0);
  v_housing numeric := coalesce((p_fields->>'accruedHousingAllowance')::numeric,0);
  v_performance numeric := coalesce((p_fields->>'accruedPerformance')::numeric,0);
  v_attendance_bonus numeric := coalesce((p_fields->>'accruedFullAttendanceBonus')::numeric,0);
  v_service_award numeric := coalesce((p_fields->>'accruedServiceAward')::numeric,0);
  v_commission numeric := coalesce((p_fields->>'accruedCommission')::numeric,0);
  v_overtime numeric := coalesce((p_fields->>'accruedOvertime')::numeric,0);
  v_fine numeric := coalesce((p_fields->>'fineTotal')::numeric,0);
  v_payable numeric;
  v_was_confirmed boolean;
begin
  select * into v_row from public.payroll_payslips where id=p_payslip_id for update;
  if v_row.id is null or public.current_user_role()<>'admin' or not public.can_admin_manage_attendance_profile(v_row.profile_id) then raise exception '没有该工资单的操作权限'; end if;
  if v_row.status='withdrawn' then raise exception '已撤回工资单不能修改，请重新生成'; end if;
  if least(v_base,v_housing,v_performance,v_attendance_bonus,v_service_award,v_commission,v_overtime,v_fine)<0 then raise exception '工资单金额不能小于 0'; end if;
  v_payable := v_base+v_housing+v_performance+v_attendance_bonus+v_service_award+v_commission+v_overtime-v_fine;
  v_was_confirmed := v_row.status='confirmed';
  update public.payroll_payslips set
    estimate_snapshot=estimate_snapshot||jsonb_build_object(
      'accruedBaseSalary',v_base,'accruedHousingAllowance',v_housing,'accruedPerformance',v_performance,
      'accruedFullAttendanceBonus',v_attendance_bonus,'accruedServiceAward',v_service_award,
      'accruedCommission',v_commission,'accruedOvertime',v_overtime,'fineTotal',v_fine,
      'incomeSubtotalKnown',v_base+v_housing+v_performance+v_attendance_bonus+v_service_award+v_commission+v_overtime,
      'knownEstimatedPayable',v_payable,'estimatedPayable',v_payable,'dataComplete',true,'dataIssues',jsonb_build_array()
    ),
    admin_note=btrim(coalesce(p_fields->>'adminNote','')),
    status=case when status='confirmed' then 'issued' else status end,
    confirmed_at=case when status='confirmed' then null else confirmed_at end,
    revision=revision+1,last_modified_by=auth.uid()
  where id=v_row.id returning * into v_row;
  if v_row.status='issued' then
    insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    values(v_row.profile_id,v_row.store_id,'payroll_payslip_updated',to_char(v_row.payroll_month,'YYYY年MM月')||'工资单已调整',case when v_was_confirmed then '工资单内容已调整，请重新核对并确认。' else '工资单内容已调整，请核对最新内容。' end,'payroll_payslip',v_row.id,'payroll-payslip:'||v_row.profile_id||':'||v_row.payroll_month::text)
    on conflict(dedupe_key) do update set type=excluded.type,title=excluded.title,body=excluded.body,is_read=false,read_at=null,created_at=now();
  end if;
  return to_jsonb(v_row);
end;
$$;

create function public.admin_withdraw_payroll_payslip(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.payroll_payslips;
begin
  select * into v_row from public.payroll_payslips where id=p_payslip_id for update;
  if v_row.id is null or public.current_user_role()<>'admin' or not public.can_admin_manage_attendance_profile(v_row.profile_id) then raise exception '没有该工资单的操作权限'; end if;
  if v_row.status='withdrawn' then raise exception '工资单已经撤回'; end if;
  update public.payroll_payslips set status='withdrawn',withdrawn_at=now(),withdrawn_by=auth.uid(),confirmed_at=null,revision=revision+1,last_modified_by=auth.uid()
  where id=v_row.id returning * into v_row;
  delete from public.notifications where entity_type='payroll_payslip' and entity_id=v_row.id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.issue_payroll_payslips_internal(
  p_payroll_month date,p_profile_ids uuid[],p_issue_source text,p_issued_by uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_month date:=date_trunc('month',p_payroll_month)::date; v_today date:=(now() at time zone 'Asia/Shanghai')::date; v_as_of date;
  v_profile public.profiles; v_snapshot jsonb; v_existing public.payroll_payslips; v_payslip public.payroll_payslips;
  v_issued integer:=0; v_refreshed integer:=0; v_skipped integer:=0;
begin
  if p_issue_source not in ('scheduled','admin') then raise exception '工资单发放来源无效'; end if;
  if v_month>date_trunc('month',v_today)::date then raise exception '不能发放未来月份的工资单'; end if;
  if coalesce(cardinality(p_profile_ids),0)=0 then return jsonb_build_object('issuedCount',0,'refreshedCount',0,'skippedConfirmedCount',0,'month',v_month); end if;
  v_as_of:=case when v_month=date_trunc('month',v_today)::date then v_today else (v_month+interval '1 month - 1 day')::date end;
  for v_profile in select * from public.profiles where id=any(p_profile_ids) and role in ('staff','manager') and is_active and deleted_at is null loop
    select * into v_existing from public.payroll_payslips where profile_id=v_profile.id and payroll_month=v_month for update;
    if v_existing.id is not null and v_existing.status='confirmed' then v_skipped:=v_skipped+1; continue; end if;
    v_snapshot:=public.get_payroll_estimate(v_profile.id,v_as_of);
    if v_existing.id is null then
      insert into public.payroll_payslips(profile_id,store_id,payroll_month,estimate_snapshot,status,issue_source,issued_at,issued_by)
      values(v_profile.id,nullif(v_snapshot->>'primaryStoreId','')::uuid,v_month,v_snapshot,'issued',p_issue_source,now(),p_issued_by) returning * into v_payslip;
      v_issued:=v_issued+1;
    else
      update public.payroll_payslips set store_id=nullif(v_snapshot->>'primaryStoreId','')::uuid,estimate_snapshot=v_snapshot,status='issued',issue_source=p_issue_source,issued_at=now(),issued_by=p_issued_by,confirmed_at=null,withdrawn_at=null,withdrawn_by=null,revision=revision+1
      where id=v_existing.id returning * into v_payslip;
      v_refreshed:=v_refreshed+1;
    end if;
    insert into public.notifications(recipient_user_id,store_id,type,title,body,entity_type,entity_id,dedupe_key)
    values(v_profile.id,v_payslip.store_id,'payroll_payslip_issued',to_char(v_month,'YYYY年MM月')||'工资单已发放','请核对工资单内容，并在“我的薪资”中确认。','payroll_payslip',v_payslip.id,'payroll-payslip:'||v_profile.id||':'||v_month::text)
    on conflict(dedupe_key) do update set type=excluded.type,title=excluded.title,body=excluded.body,entity_id=excluded.entity_id,is_read=false,read_at=null,created_at=now();
  end loop;
  return jsonb_build_object('issuedCount',v_issued,'refreshedCount',v_refreshed,'skippedConfirmedCount',v_skipped,'month',v_month,'asOf',v_as_of);
end;
$$;

revoke all on function public.admin_generate_payroll_payslips(date,uuid[]) from public,anon;
revoke all on function public.admin_send_payroll_payslip(uuid) from public,anon;
revoke all on function public.admin_update_payroll_payslip(uuid,jsonb) from public,anon;
revoke all on function public.admin_withdraw_payroll_payslip(uuid) from public,anon;
grant execute on function public.admin_generate_payroll_payslips(date,uuid[]) to authenticated;
grant execute on function public.admin_send_payroll_payslip(uuid) to authenticated;
grant execute on function public.admin_update_payroll_payslip(uuid,jsonb) to authenticated;
grant execute on function public.admin_withdraw_payroll_payslip(uuid) to authenticated;
revoke execute on function public.admin_issue_payroll_payslips(date,uuid[]) from authenticated;
