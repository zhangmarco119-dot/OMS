-- Keep page-entry audit evidence while suppressing repeated activity from the
-- same employee on the same page category for one minute.
create or replace function public.record_system_activity(
  p_module text,
  p_view text,
  p_period text default null,
  p_store_id uuid default null,
  p_target_profile_id uuid default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_operation text;
  v_summary text;
  v_metadata jsonb;
  v_event_key text;
  v_activity_category text;
  v_existing uuid;
  v_id uuid;
  v_store_name text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
begin
  if auth.uid() is null then
    raise exception '需要登录后记录操作' using errcode = '42501';
  end if;
  if p_module not in ('auth','attendance','payroll') then
    raise exception '不支持的日志模块';
  end if;
  if not (
    (p_module = 'auth' and p_view = 'login')
    or (p_module = 'attendance' and p_view in ('month_summary','month_detail'))
    or (p_module = 'payroll' and p_view in ('estimate_summary','estimate_detail','payslip_list','payslip_detail','settings'))
  ) then
    raise exception '不支持的查看类型';
  end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception '日志上下文格式无效';
  end if;

  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.id is null then
    raise exception '账号资料不存在' using errcode = '42501';
  end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then
    raise exception '没有该门店的访问权限' using errcode = '42501';
  end if;
  if p_target_profile_id is not null then
    select * into v_target from public.profiles where id = p_target_profile_id;
    if v_target.id is null then raise exception '目标账号不存在'; end if;
    if v_target.id <> v_actor.id and v_actor.role <> 'admin' then
      raise exception '没有查看其他账号的权限' using errcode = '42501';
    end if;
  end if;
  if p_module <> 'auth' and p_target_profile_id is null and v_actor.role <> 'admin' then
    p_target_profile_id := v_actor.id;
    v_target := v_actor;
  end if;

  select name into v_store_name from public.stores where id = p_store_id;
  v_operation := case when p_view = 'login' then 'login' else 'viewed' end;
  v_summary := case p_view
    when 'login' then '登录系统'
    when 'month_summary' then '查看' || coalesce(p_period, '所选月份') || '月度考勤汇总'
    when 'month_detail' then '查看' || coalesce(nullif(v_target.display_name, ''), '员工') || '的' || coalesce(p_period, '所选月份') || '考勤详情'
    when 'estimate_summary' then '查看' || coalesce(p_period, '所选月份') || '员工薪资汇总'
    when 'estimate_detail' then '查看' || coalesce(nullif(v_target.display_name, ''), '本人') || '的' || coalesce(p_period, '所选月份') || '预估薪资'
    when 'payslip_list' then '查看工资单列表'
    when 'payslip_detail' then '查看' || coalesce(nullif(v_target.display_name, ''), '本人') || '的' || coalesce(p_period, '所选月份') || '工资单'
    when 'settings' then '查看薪资配置'
  end;

  v_event_key := concat_ws(':', p_module, p_view, coalesce(p_period, ''), coalesce(p_store_id::text, ''), coalesce(p_target_profile_id::text, ''), coalesce(p_context->>'scope', ''));
  v_activity_category := p_module || ':' || p_view;

  -- Serialize requests for the same actor/page category so simultaneous tabs
  -- cannot bypass the one-minute window.
  perform pg_advisory_xact_lock(hashtextextended(v_actor.id::text || ':' || v_activity_category, 0));

  select id into v_existing
  from public.system_operation_logs
  where actor_id = v_actor.id
    and module = p_module
    and operation = v_operation
    and (
      metadata->>'activityCategory' = v_activity_category
      or (metadata->>'activityCategory' is null and metadata->>'viewType' = p_view)
    )
    and occurred_at >= now() - interval '1 minute'
  order by occurred_at desc
  limit 1;
  if v_existing is not null then return v_existing; end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'eventKey', v_event_key,
    'activityCategory', v_activity_category,
    'dedupeWindowSeconds', 60,
    'viewType', p_view,
    'period', nullif(p_period, ''),
    'storeName', v_store_name,
    'targetProfileId', p_target_profile_id,
    'targetDisplayName', nullif(v_target.display_name, ''),
    'targetUsername', nullif(v_target.username, ''),
    'scope', nullif(p_context->>'scope', ''),
    'statusFilter', nullif(p_context->>'statusFilter', ''),
    'loginMethod', nullif(p_context->>'loginMethod', ''),
    'pagePath', left(nullif(p_context->>'pagePath', ''), 240),
    'clientRelease', coalesce(nullif(v_headers->>'x-storehub-release', ''), nullif(p_context->>'clientRelease', '')),
    'clientPlatform', left(nullif(p_context->>'clientPlatform', ''), 120)
  ));

  insert into public.system_operation_logs(
    actor_id, actor_name_snapshot, actor_username_snapshot, actor_role_snapshot,
    actor_employment_type_snapshot, store_id, module, operation, entity_type,
    entity_id, summary, metadata
  ) values (
    v_actor.id, v_actor.display_name, v_actor.username, v_actor.role,
    v_actor.employment_type, p_store_id, p_module, v_operation,
    p_module || '_' || p_view, p_target_profile_id, left(v_summary, 160), v_metadata
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_system_activity(text,text,text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.record_system_activity(text,text,text,uuid,uuid,jsonb) to authenticated;

comment on function public.record_system_activity(text,text,text,uuid,uuid,jsonb) is
  'Records login and attendance/payroll page entries, deduplicated by actor and page category for one minute without sensitive values.';
