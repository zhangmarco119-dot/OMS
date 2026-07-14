do $$
begin
  if to_regclass('public.v2_task_item_reviews') is null then
    raise exception 'V2 task item review history table missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v2_task_answers' and column_name = 'review_status'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v2_task_answers' and column_name = 'submission_round'
  ) then
    raise exception 'V2 task answer review state columns missing';
  end if;
  if to_regprocedure('public.review_v2_task_items(uuid,jsonb,text)') is null
    or to_regprocedure('public.can_edit_v2_task_item(uuid,uuid)') is null then
    raise exception 'V2 task item review RPC or edit guard missing';
  end if;
  if has_table_privilege('authenticated', 'public.v2_task_item_reviews', 'INSERT,UPDATE,DELETE') then
    raise exception 'V2 task item review history must block direct writes';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'v2_task_item_reviews'
      and policyname = 'v2_task_item_reviews_select_allowed'
  ) then
    raise exception 'V2 task item review RLS policy missing';
  end if;
  raise notice 'StoreHub V2 item-level review schema checks passed';
end $$;
