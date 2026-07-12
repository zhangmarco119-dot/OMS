do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v2_task_templates' and column_name = 'recurrence_day'
  ) then raise exception 'V2 task template recurrence_day is missing'; end if;
  if to_regprocedure('public.next_v2_task_template_due(uuid)') is null then raise exception 'V2 recurring due helper is missing'; end if;
  if position('select public.can_manage_v2_task_template(target_template_id)' in pg_get_functiondef('public.can_view_v2_task_template(uuid)'::regprocedure)) = 0 then
    raise exception 'store users must not be able to read task templates';
  end if;
  raise notice 'StoreHub V2 task visibility and schedule checks passed';
end $$;
