-- Replace the fixed monthly payslip push with an administrator-controlled
-- schedule. Automatic delivery is disabled by default.

create table public.payroll_payslip_schedule_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  frequency_months smallint not null default 1 check (frequency_months between 1 and 12),
  day_of_month smallint not null default 1 check (day_of_month between 1 and 28),
  send_time time not null default '09:00',
  last_issued_month date,
  last_run_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_payslip_schedule_last_month_check
    check (last_issued_month is null or last_issued_month = date_trunc('month', last_issued_month)::date)
);

create trigger payroll_payslip_schedule_settings_touch_updated_at
before update on public.payroll_payslip_schedule_settings
for each row execute function public.touch_updated_at();

alter table public.payroll_payslip_schedule_settings enable row level security;

create policy payroll_payslip_schedule_settings_admin_select
on public.payroll_payslip_schedule_settings
for select to authenticated
using (public.current_user_role() = 'admin');

grant select on public.payroll_payslip_schedule_settings to authenticated;

insert into public.payroll_payslip_schedule_settings(id, enabled)
values (1, false)
on conflict (id) do update set enabled = false, updated_at = now();

create function public.get_payroll_payslip_schedule_settings()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_setting public.payroll_payslip_schedule_settings;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  select * into v_setting from public.payroll_payslip_schedule_settings where id = 1;
  return jsonb_build_object(
    'enabled', v_setting.enabled,
    'frequencyMonths', v_setting.frequency_months,
    'dayOfMonth', v_setting.day_of_month,
    'sendTime', to_char(v_setting.send_time, 'HH24:MI'),
    'lastIssuedMonth', v_setting.last_issued_month,
    'lastRunAt', v_setting.last_run_at
  );
end;
$$;

create function public.admin_save_payroll_payslip_schedule_settings(
  p_enabled boolean,
  p_frequency_months smallint,
  p_day_of_month smallint,
  p_send_time time
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_setting public.payroll_payslip_schedule_settings;
begin
  if public.current_user_role() <> 'admin' then raise exception '需要管理员权限'; end if;
  if p_frequency_months not between 1 and 12 then raise exception '自动推送周期应为 1 到 12 个月'; end if;
  if p_day_of_month not between 1 and 28 then raise exception '自动推送日期应为每月 1 到 28 日'; end if;
  if p_send_time is null then raise exception '请选择自动推送时间'; end if;

  update public.payroll_payslip_schedule_settings
  set enabled = p_enabled,
      frequency_months = p_frequency_months,
      day_of_month = p_day_of_month,
      send_time = p_send_time,
      updated_by = auth.uid()
  where id = 1
  returning * into v_setting;

  return jsonb_build_object(
    'enabled', v_setting.enabled,
    'frequencyMonths', v_setting.frequency_months,
    'dayOfMonth', v_setting.day_of_month,
    'sendTime', to_char(v_setting.send_time, 'HH24:MI'),
    'lastIssuedMonth', v_setting.last_issued_month,
    'lastRunAt', v_setting.last_run_at
  );
end;
$$;

create or replace function public.issue_scheduled_payroll_payslips()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_setting public.payroll_payslip_schedule_settings;
  v_local_now timestamp := now() at time zone 'Asia/Shanghai';
  v_target_month date;
  v_month_gap integer;
  v_targets uuid[];
  v_result jsonb;
begin
  select * into v_setting
  from public.payroll_payslip_schedule_settings
  where id = 1
  for update;

  if not coalesce(v_setting.enabled, false) then
    return jsonb_build_object('skipped', true, 'reason', 'disabled');
  end if;
  if extract(day from v_local_now)::integer <> v_setting.day_of_month then
    return jsonb_build_object('skipped', true, 'reason', 'not_scheduled_day');
  end if;
  if v_local_now::time < v_setting.send_time then
    return jsonb_build_object('skipped', true, 'reason', 'before_scheduled_time');
  end if;

  v_target_month := (date_trunc('month', v_local_now) - interval '1 month')::date;
  if v_setting.last_issued_month is not null then
    v_month_gap := (extract(year from age(v_target_month, v_setting.last_issued_month))::integer * 12)
      + extract(month from age(v_target_month, v_setting.last_issued_month))::integer;
    if v_target_month <= v_setting.last_issued_month or v_month_gap < v_setting.frequency_months then
      return jsonb_build_object('skipped', true, 'reason', 'cycle_not_due', 'targetMonth', v_target_month);
    end if;
  end if;

  select coalesce(array_agg(id order by display_name), array[]::uuid[])
  into v_targets
  from public.profiles
  where role in ('staff', 'manager') and is_active and deleted_at is null;

  v_result := public.issue_payroll_payslips_internal(v_target_month, v_targets, 'scheduled', null);
  update public.payroll_payslip_schedule_settings
  set last_issued_month = v_target_month,
      last_run_at = now()
  where id = 1;

  return v_result || jsonb_build_object('scheduled', true);
end;
$$;

revoke all on function public.get_payroll_payslip_schedule_settings() from public, anon;
revoke all on function public.admin_save_payroll_payslip_schedule_settings(boolean, smallint, smallint, time) from public, anon;
grant execute on function public.get_payroll_payslip_schedule_settings() to authenticated;
grant execute on function public.admin_save_payroll_payslip_schedule_settings(boolean, smallint, smallint, time) to authenticated;

do $$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job where jobname = 'storehub-monthly-payroll-payslips' loop
    perform cron.unschedule(job_id);
  end loop;
  perform cron.schedule(
    'storehub-monthly-payroll-payslips',
    '*/10 * * * *',
    $cron$select public.issue_scheduled_payroll_payslips();$cron$
  );
end;
$$;
