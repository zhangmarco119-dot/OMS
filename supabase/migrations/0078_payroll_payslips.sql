create extension if not exists pg_cron with schema pg_catalog;

create table public.payroll_payslips (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  estimate_snapshot jsonb not null,
  status text not null default 'issued' check (status in ('issued','confirmed')),
  issue_source text not null check (issue_source in ('scheduled','admin')),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, payroll_month),
  check ((status = 'confirmed' and confirmed_at is not null) or (status = 'issued' and confirmed_at is null))
);

create index payroll_payslips_profile_month_idx on public.payroll_payslips(profile_id, payroll_month desc);
create index payroll_payslips_pending_idx on public.payroll_payslips(profile_id, issued_at desc) where status = 'issued';

create trigger payroll_payslips_touch_updated_at
before update on public.payroll_payslips
for each row execute function public.touch_updated_at();

alter table public.payroll_payslips enable row level security;

create policy payroll_payslips_select on public.payroll_payslips
for select to authenticated using (
  profile_id = auth.uid()
  or (public.current_user_role() = 'admin' and public.can_admin_manage_attendance_profile(profile_id))
);

grant select on public.payroll_payslips to authenticated;

create function public.issue_payroll_payslips_internal(
  p_payroll_month date,
  p_profile_ids uuid[],
  p_issue_source text,
  p_issued_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_payroll_month)::date;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_as_of date;
  v_profile public.profiles;
  v_snapshot jsonb;
  v_existing public.payroll_payslips;
  v_payslip public.payroll_payslips;
  v_issued integer := 0;
  v_refreshed integer := 0;
  v_skipped integer := 0;
begin
  if p_issue_source not in ('scheduled','admin') then raise exception '工资单发放来源无效'; end if;
  if v_month > date_trunc('month', v_today)::date then raise exception '不能发放未来月份的工资单'; end if;
  if coalesce(cardinality(p_profile_ids), 0) = 0 then
    return jsonb_build_object('issuedCount',0,'refreshedCount',0,'skippedConfirmedCount',0,'month',v_month);
  end if;

  v_as_of := case when v_month = date_trunc('month', v_today)::date then v_today else (v_month + interval '1 month - 1 day')::date end;

  for v_profile in
    select profile.* from public.profiles profile
    where profile.id = any(p_profile_ids)
      and profile.role in ('staff','manager')
      and profile.is_active
      and profile.deleted_at is null
  loop
    select * into v_existing from public.payroll_payslips
    where profile_id = v_profile.id and payroll_month = v_month
    for update;

    if v_existing.id is not null and v_existing.status = 'confirmed' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_snapshot := public.get_payroll_estimate(v_profile.id, v_as_of);

    if v_existing.id is null then
      insert into public.payroll_payslips(
        profile_id, store_id, payroll_month, estimate_snapshot, issue_source, issued_by
      ) values (
        v_profile.id,
        nullif(v_snapshot->>'primaryStoreId','')::uuid,
        v_month,
        v_snapshot,
        p_issue_source,
        p_issued_by
      ) returning * into v_payslip;
      v_issued := v_issued + 1;
    else
      update public.payroll_payslips set
        store_id = nullif(v_snapshot->>'primaryStoreId','')::uuid,
        estimate_snapshot = v_snapshot,
        issue_source = p_issue_source,
        issued_at = now(),
        issued_by = p_issued_by
      where id = v_existing.id
      returning * into v_payslip;
      v_refreshed := v_refreshed + 1;
    end if;

    insert into public.notifications(
      recipient_user_id, store_id, type, title, body, entity_type, entity_id, dedupe_key
    ) values (
      v_profile.id,
      v_payslip.store_id,
      'payroll_payslip_issued',
      to_char(v_month,'YYYY年MM月') || '工资单已发放',
      '请核对工资单内容，并在“我的薪资”中确认。',
      'payroll_payslip',
      v_payslip.id,
      'payroll-payslip:' || v_profile.id || ':' || v_month::text
    ) on conflict(dedupe_key) do update set
      title = excluded.title,
      body = excluded.body,
      entity_id = excluded.entity_id,
      is_read = false,
      read_at = null,
      created_at = now();
  end loop;

  return jsonb_build_object(
    'issuedCount',v_issued,
    'refreshedCount',v_refreshed,
    'skippedConfirmedCount',v_skipped,
    'month',v_month,
    'asOf',v_as_of
  );
end;
$$;

create function public.admin_issue_payroll_payslips(
  p_payroll_month date,
  p_profile_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_targets uuid[];
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;

  select coalesce(array_agg(profile.id order by profile.display_name), array[]::uuid[])
  into v_targets
  from public.profiles profile
  where profile.role in ('staff','manager')
    and profile.is_active
    and profile.deleted_at is null
    and public.can_admin_manage_attendance_profile(profile.id)
    and (coalesce(cardinality(p_profile_ids),0) = 0 or profile.id = any(p_profile_ids));

  if coalesce(cardinality(v_targets),0) = 0 then raise exception '没有可发放工资单的员工'; end if;
  return public.issue_payroll_payslips_internal(p_payroll_month, v_targets, 'admin', auth.uid());
end;
$$;

create function public.issue_scheduled_payroll_payslips()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_targets uuid[];
begin
  if extract(day from v_today)::integer <> 1 then
    return jsonb_build_object('skipped',true,'reason','not_first_day','date',v_today);
  end if;
  select coalesce(array_agg(id),array[]::uuid[]) into v_targets
  from public.profiles
  where role in ('staff','manager') and is_active and deleted_at is null;
  return public.issue_payroll_payslips_internal((date_trunc('month',v_today)-interval '1 month')::date, v_targets, 'scheduled', null);
end;
$$;

create function public.confirm_my_payroll_payslip(p_payslip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.payroll_payslips;
begin
  update public.payroll_payslips set status='confirmed', confirmed_at=now()
  where id=p_payslip_id and profile_id=auth.uid() and status='issued'
  returning * into v_row;
  if v_row.id is null then raise exception '工资单不存在、已经确认或不属于当前账号'; end if;
  update public.notifications set is_read=true, read_at=coalesce(read_at,now())
  where recipient_user_id=auth.uid() and entity_type='payroll_payslip' and entity_id=v_row.id;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.issue_payroll_payslips_internal(date,uuid[],text,uuid) from public, anon, authenticated;
revoke all on function public.issue_scheduled_payroll_payslips() from public, anon, authenticated;
revoke all on function public.admin_issue_payroll_payslips(date,uuid[]) from public, anon;
revoke all on function public.confirm_my_payroll_payslip(uuid) from public, anon;
grant execute on function public.admin_issue_payroll_payslips(date,uuid[]) to authenticated;
grant execute on function public.confirm_my_payroll_payslip(uuid) to authenticated;

do $$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job where jobname='storehub-monthly-payroll-payslips' loop
    perform cron.unschedule(job_id);
  end loop;
  perform cron.schedule(
    'storehub-monthly-payroll-payslips',
    '10 16 * * *',
    $cron$select public.issue_scheduled_payroll_payslips();$cron$
  );
end;
$$;
