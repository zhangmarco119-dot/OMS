create or replace function public.get_payroll_deduction_items(
  p_profile_id uuid,
  p_from date,
  p_to date
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'invalid payroll deduction range'; end if;
  if p_profile_id <> auth.uid() and not public.can_admin_manage_attendance_profile(p_profile_id) then
    raise exception 'payroll deduction access denied';
  end if;

  with deduction_rows as (
    select
      'late:' || daily.id::text item_id,
      daily.attendance_date event_date,
      daily.created_at,
      'late'::text item_type,
      '迟到罚款'::text title,
      ('迟到 ' || daily.late_minutes || ' 分钟')::text reason,
      (case when daily.late_minutes between 1 and 10 then 20
            when daily.late_minutes between 11 and 20 then 50
            when daily.late_minutes between 21 and 30 then 100
            when daily.late_minutes >= 31 then 200 else 0 end)::numeric amount,
      0::numeric performance_deduction
    from public.attendance_daily_records daily
    where daily.profile_id = p_profile_id
      and daily.attendance_date between p_from and p_to
      and daily.late_minutes > 0
    union all
    select
      'penalty:' || penalty.id::text,
      penalty.event_date,
      penalty.created_at,
      'penalty'::text,
      '其他罚款'::text,
      penalty.reason,
      penalty.amount,
      penalty.performance_deduction
    from public.payroll_penalties penalty
    where penalty.profile_id = p_profile_id
      and penalty.event_date between p_from and p_to
      and penalty.status = 'active'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item_id,
    'date', event_date,
    'createdAt', created_at,
    'type', item_type,
    'title', title,
    'reason', reason,
    'amount', amount,
    'performanceDeduction', performance_deduction
  ) order by event_date desc, created_at desc), '[]'::jsonb)
  into v_items
  from deduction_rows
  where amount > 0 or item_type = 'penalty';

  return v_items;
end;
$$;

revoke all on function public.get_payroll_deduction_items(uuid,date,date) from public,anon;
grant execute on function public.get_payroll_deduction_items(uuid,date,date) to authenticated;
