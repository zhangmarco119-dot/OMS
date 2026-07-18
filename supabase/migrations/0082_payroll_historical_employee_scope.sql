-- Historical administrator lists should not show accounts created in a later
-- month unless imported attendance proves that the employee worked then.

create or replace function public.admin_payroll_estimates(
  p_as_of date default ((now() at time zone 'Asia/Shanghai')::date),
  p_store_id uuid default null,
  p_search text default ''
)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_result jsonb; v_month_start date:=date_trunc('month',p_as_of)::date; v_month_end date:=(date_trunc('month',p_as_of)+interval '1 month - 1 day')::date;
begin
  if public.current_user_role() <> 'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  with targets as (
    select profile.id from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and profile.display_name not in ('李荣珊','李荣妹','李荣美') and public.can_admin_manage_attendance_profile(profile.id)
      and (
        v_month_start=date_trunc('month',now() at time zone 'Asia/Shanghai')::date
        or profile.created_at::date<=v_month_end
        or exists(select 1 from public.attendance_daily_records daily where daily.profile_id=profile.id and daily.attendance_date between v_month_start and v_month_end)
      )
      and (p_store_id is null or profile.store_id = p_store_id or exists (
        select 1 from public.dingtalk_employee_bindings binding where binding.profile_id = profile.id and binding.store_id = p_store_id and binding.binding_status = 'active'))
      and (trim(coalesce(p_search, '')) = '' or profile.display_name ilike '%' || trim(p_search) || '%' or profile.username ilike '%' || trim(p_search) || '%')
  ), estimates as (select public.get_payroll_estimate(target.id, p_as_of) estimate from targets target)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(estimate order by estimate->>'displayName'), '[]'::jsonb),
    'employeeCount', count(*), 'completeCount', count(*) filter (where (estimate->>'dataComplete')::boolean),
    'incompleteCount', count(*) filter (where not (estimate->>'dataComplete')::boolean),
    'knownEstimatedTotal', coalesce(sum((estimate->>'knownEstimatedPayable')::numeric), 0),
    'completeEstimatedTotal', coalesce(sum((estimate->>'estimatedPayable')::numeric) filter (where estimate->>'estimatedPayable' is not null), 0)
  ) into v_result from estimates;
  return v_result;
end;
$$;

revoke all on function public.admin_payroll_estimates(date,uuid,text) from public,anon;
grant execute on function public.admin_payroll_estimates(date,uuid,text) to authenticated;
