-- An employee-specific default is separate from monthly decisions, so a
-- manager's explicit grade, score or automatic choice always takes priority.
create table public.payroll_default_performance_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  default_grade text not null check (default_grade in ('A','B','C','D')),
  effective_from date not null check (extract(day from effective_from)=1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.payroll_default_performance_settings enable row level security;
create policy payroll_default_performance_admin_read on public.payroll_default_performance_settings
  for select to authenticated using (public.current_user_role()='admin' and public.can_admin_manage_attendance_profile(profile_id));
revoke all on public.payroll_default_performance_settings from public,anon,authenticated;
grant select on public.payroll_default_performance_settings to authenticated,service_role;

create function private.payroll_default_performance_grade(p_profile_id uuid,p_month date)
returns text language sql stable security definer set search_path=public as $$
 select default_grade from public.payroll_default_performance_settings
 where profile_id=p_profile_id and effective_from<=date_trunc('month',p_month)::date;
$$;
revoke all on function private.payroll_default_performance_grade(uuid,date) from public,anon,authenticated;
grant execute on function private.payroll_default_performance_grade(uuid,date) to postgres;

-- Preserve a deliberate choice to use automatic scoring, instead of confusing
-- it with the absence of any choice for the month.
alter table public.payroll_store_performance_overrides
 drop constraint payroll_store_performance_overrides_override_mode_check,
 drop constraint payroll_store_performance_overrides_check;
alter table public.payroll_store_performance_overrides
 add constraint payroll_store_performance_overrides_override_mode_check check (override_mode in ('automatic','score','grade')),
 add constraint payroll_store_performance_overrides_check check (
   (override_mode='automatic' and performance_score is null and performance_grade is null)
   or (override_mode='score' and performance_score is not null and performance_grade is null)
   or (override_mode='grade' and performance_grade is not null and performance_score is null)
 );

do $migration$
declare v_sql text;
begin
 select pg_get_functiondef('public.admin_save_payroll_monthly_performance(uuid,date,jsonb,numeric)'::regprocedure) into v_sql;
 if position('if v_mode <> ''automatic'' then' in v_sql)=0 or position('v_explicit_count := v_explicit_count + 1;' in v_sql)=0 then
  raise exception 'Monthly performance save contract changed';
 end if;
 v_sql:=replace(v_sql,'if v_mode <> ''automatic'' then',
   'if v_mode <> ''automatic'' or private.payroll_default_performance_grade(p_profile_id,v_month) is not null then');
 v_sql:=replace(v_sql,'v_explicit_count := v_explicit_count + 1;',
   'if v_mode <> ''automatic'' then v_explicit_count := v_explicit_count + 1; end if;');
 execute v_sql;

 select pg_get_functiondef('public.calculate_payroll_estimate_before_departure_month(uuid,date)'::regprocedure) into v_sql;
 if position('v_grade text;' in v_sql)=0
   or position('if v_store_count <= 1 and v_config_count = 0' in v_sql)=0
   or position('select * into v_override from public.payroll_store_performance_overrides setting' in v_sql)=0
   or position('''calculationMode'', case when found then v_override.override_mode else ''automatic'' end' in v_sql)=0 then
  raise exception 'Performance calculation contract changed';
 end if;
 v_sql:=replace(v_sql,'v_grade text;','v_grade text; v_default_grade text; v_override_mode text; v_legacy_score numeric;');
 v_sql:=replace(v_sql,'if v_store_count <= 1 and v_config_count = 0',
   'v_default_grade:=private.payroll_default_performance_grade(p_profile_id,v_month);
  if v_store_count <= 1 and v_config_count = 0 and v_default_grade is null');
 v_sql:=replace(v_sql,
   'if found and v_override.override_mode = ''score'' then',
   'v_override_mode:=case when found then v_override.override_mode else null end;
    -- Legacy score overrides were manual choices for a single unconfigured store.
    if v_override_mode is null and v_default_grade is not null and v_config_count=0 and v_store_count<=1 then
      select performance_score into v_legacy_score from public.payroll_performance_overrides where profile_id=p_profile_id and payroll_month=v_month;
      if v_legacy_score is not null then v_override_mode:=''score''; v_override.performance_score:=v_legacy_score; end if;
    end if;
    if v_override_mode is null and v_default_grade is not null then
      v_override_mode:=''grade''; v_override.performance_grade:=v_default_grade;
    end if;
    if v_override_mode = ''score'' then');
 v_sql:=replace(v_sql,'elsif found and v_override.override_mode = ''grade'' then','elsif v_override_mode = ''grade'' then');
 v_sql:=replace(v_sql,'if found and v_override.override_mode = ''grade'' then','if v_override_mode = ''grade'' then');
 v_sql:=replace(v_sql,'''calculationMode'', case when found then v_override.override_mode else ''automatic'' end',
   '''calculationMode'', coalesce(v_override_mode, ''automatic'')');
 execute v_sql;
end $migration$;
notify pgrst,'reload schema';
