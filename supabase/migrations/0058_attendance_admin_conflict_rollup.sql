-- Ensure the administrator overview classifies real same-day multi-store schedules as abnormal.

create or replace function public.admin_attendance_month(p_month date,p_store_id uuid default null,p_search text default '',p_status text default 'all',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare v_month date:=date_trunc('month',p_month)::date; v_result jsonb;
begin
  if public.current_user_role()<>'admin' then raise exception 'administrator permission required'; end if;
  if p_store_id is not null and not public.has_store_access(p_store_id) then raise exception 'store access denied'; end if;
  if p_status not in ('all','normal','late','missing','abnormal','unbound') then raise exception 'invalid attendance status filter'; end if;
  if p_limit<1 or p_limit>100 or p_offset<0 then raise exception 'invalid pagination'; end if;
  with targets as (
    select profile.id,profile.display_name,profile.username,profile.store_id,
      coalesce((select string_agg(distinct store.name,'、' order by store.name) from public.stores store where (store.id=profile.store_id or exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=profile.id and binding.store_id=store.id and binding.binding_status='active')) and public.has_store_access(store.id)),'未知门店') store_name
    from public.profiles profile
    where profile.role in ('staff','manager') and profile.is_active and profile.deleted_at is null
      and (public.has_store_access(profile.store_id) or exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=profile.id and binding.binding_status='active' and public.has_store_access(binding.store_id)))
      and (p_store_id is null or profile.store_id=p_store_id or exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=profile.id and binding.store_id=p_store_id and binding.binding_status='active'))
      and (trim(coalesce(p_search,''))='' or profile.display_name ilike '%'||trim(p_search)||'%' or profile.username ilike '%'||trim(p_search)||'%')
  ), daily_by_date as (
    select daily.profile_id,daily.attendance_date,bool_or(daily.is_attended) is_attended,
      bool_or(daily.daily_status='late') is_late,bool_or(daily.daily_status='missing') is_missing,
      bool_or(daily.daily_status='abnormal') or count(distinct daily.store_id) filter(
        where daily.daily_status not in ('rest','leave','business_trip') and daily.planned_on_at is not null
          and (daily.planned_on_at at time zone daily.enterprise_timezone)::date=daily.attendance_date
      )>1 is_abnormal,
      sum(daily.late_minutes)::integer late_minutes,max(daily.last_synced_at) last_synced_at
    from public.attendance_daily_records daily
    where daily.attendance_date>=v_month and daily.attendance_date<(v_month+interval '1 month')::date
      and public.can_admin_read_attendance_store(daily.store_id) and (p_store_id is null or daily.store_id=p_store_id)
    group by daily.profile_id,daily.attendance_date
  ), stats as (
    select profile_id,array_agg(attendance_date order by attendance_date) filter(where is_attended) attendance_dates,
      count(*) filter(where is_attended)::integer attendance_days,count(*) filter(where is_late)::integer late_count,
      coalesce(sum(late_minutes),0)::integer late_minutes,count(*) filter(where is_missing)::integer missing_count,
      count(*) filter(where is_abnormal)::integer abnormal_count,max(last_synced_at) last_synced_at
    from daily_by_date group by profile_id
  ), rows as (
    select target.*,coalesce(stats.attendance_dates,'{}'::date[]) attendance_dates,coalesce(stats.attendance_days,0) attendance_days,
      coalesce(stats.late_count,0) late_count,coalesce(stats.late_minutes,0) late_minutes,coalesce(stats.missing_count,0) missing_count,
      coalesce(stats.abnormal_count,0) abnormal_count,stats.last_synced_at,
      case when exists(select 1 from public.dingtalk_employee_bindings binding where binding.profile_id=target.id and binding.binding_status='active') then 'active' else 'unbound' end binding_status
    from targets target left join stats on stats.profile_id=target.id
  ), filtered as (
    select * from rows where p_status='all' or (p_status='normal' and binding_status='active' and late_count=0 and missing_count=0 and abnormal_count=0)
      or (p_status='late' and late_count>0) or (p_status='missing' and missing_count>0) or (p_status='abnormal' and abnormal_count>0) or (p_status='unbound' and binding_status='unbound')
  ), paged as (select * from filtered order by store_name,display_name limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'items',coalesce((select jsonb_agg(jsonb_build_object('profileId',id,'displayName',display_name,'storeId',store_id,'storeName',store_name,'attendanceDates',to_jsonb(attendance_dates),'attendanceDays',attendance_days,'lateCount',late_count,'lateMinutes',late_minutes,'missingCount',missing_count,'abnormalCount',abnormal_count,'bindingStatus',binding_status,'lastSyncedAt',last_synced_at) order by store_name,display_name) from paged),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_attendance_month(date,uuid,text,text,integer,integer) from public;
grant execute on function public.admin_attendance_month(date,uuid,text,text,integer,integer) to authenticated;
