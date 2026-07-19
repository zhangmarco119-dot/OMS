-- Central, privacy-conscious business operation log. It stores actor and
-- status snapshots, never passwords, tokens, image contents or full rows.
create table public.system_operation_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name_snapshot text not null,
  actor_role_snapshot text not null check (actor_role_snapshot in ('staff','manager','admin','system')),
  actor_employment_type_snapshot text check (actor_employment_type_snapshot in ('full_time','part_time')),
  store_id uuid references public.stores(id) on delete set null,
  module text not null,
  operation text not null check (operation in ('created','updated','deleted')),
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (nullif(btrim(actor_name_snapshot),'') is not null),
  check (nullif(btrim(module),'') is not null),
  check (nullif(btrim(entity_type),'') is not null),
  check (jsonb_typeof(metadata)='object')
);

create index system_operation_logs_occurred_idx on public.system_operation_logs(occurred_at desc);
create index system_operation_logs_actor_idx on public.system_operation_logs(actor_id,occurred_at desc);
create index system_operation_logs_store_idx on public.system_operation_logs(store_id,occurred_at desc);
create index system_operation_logs_module_idx on public.system_operation_logs(module,occurred_at desc);

alter table public.system_operation_logs enable row level security;
create policy system_operation_logs_admin_read on public.system_operation_logs for select to authenticated
using (public.current_user_role()='admin' and (store_id is null or public.has_store_access(store_id)));
grant select on public.system_operation_logs to authenticated;

create or replace function public.capture_system_operation_log()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_store_id uuid;
  v_entity_id uuid;
  v_module text;
  v_label text;
  v_operation text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_summary text;
begin
  if v_actor is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  select * into v_profile from public.profiles where id=v_actor;
  if v_profile.id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  begin v_store_id := nullif(v_data->>'store_id','')::uuid; exception when others then v_store_id := null; end;
  begin v_entity_id := nullif(v_data->>'id','')::uuid; exception when others then v_entity_id := null; end;
  v_entity_id := coalesce(v_entity_id,
    case when tg_table_name='profiles' then nullif(v_data->>'id','')::uuid else null end,
    case when tg_table_name='v2_notice_stores' then nullif(v_data->>'notice_id','')::uuid else null end,
    case when tg_table_name='v2_sop_stores' then nullif(v_data->>'sop_id','')::uuid else null end);

  v_module := case tg_table_name
    when 'tasks' then 'inventory_order'
    when 'arrival_reports' then 'arrival'
    when 'v2_tasks' then 'task'
    when 'v2_task_templates' then 'task_template'
    when 'v2_notices' then 'notice'
    when 'v2_sops' then 'sop'
    when 'products' then 'product'
    when 'profiles' then 'account'
    when 'payroll_overtime_requests' then 'work_hours'
    when 'payroll_penalties' then 'penalty'
    when 'operation_reports' then 'operation_report'
    when 'operation_report_templates' then 'operation_report_template'
    else tg_table_name end;
  v_label := coalesce(nullif(v_data->>'title',''),nullif(v_data->>'name',''),nullif(v_data->>'report_no',''),nullif(v_data->>'username',''),v_entity_id::text,'记录');
  v_summary := left(v_label,120);

  insert into public.system_operation_logs(actor_id,actor_name_snapshot,actor_role_snapshot,
    actor_employment_type_snapshot,store_id,module,operation,entity_type,entity_id,summary,metadata)
  values(v_actor,v_profile.display_name,v_profile.role,v_profile.employment_type,v_store_id,
    v_module,v_operation,tg_table_name,v_entity_id,v_summary,
    jsonb_strip_nulls(jsonb_build_object(
      'beforeStatus',nullif(v_old->>'status',''),'afterStatus',nullif(v_data->>'status',''),
      'targetProfileId',case when tg_table_name='profiles' then v_data->>'id' else v_data->>'profile_id' end,
      'reportDate',v_data->>'report_date','taskType',v_data->>'task_type'
    )));
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.capture_system_operation_log() from public,anon,authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'tasks','arrival_reports','v2_tasks','v2_task_templates','v2_notices','v2_sops',
    'products','profiles','payroll_overtime_requests','payroll_penalties',
    'operation_reports','operation_report_templates'
  ] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop trigger if exists %I on public.%I','audit_'||v_table,v_table);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.capture_system_operation_log()','audit_'||v_table,v_table);
    end if;
  end loop;
end $$;
