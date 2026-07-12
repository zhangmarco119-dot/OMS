do $$ begin
 if to_regclass('public.v2_tasks') is null or to_regclass('public.v2_task_answers') is null or to_regclass('public.v2_task_images') is null or to_regclass('public.v2_task_reviews') is null then raise exception 'V2 task execution tables missing'; end if;
 if to_regprocedure('public.publish_v2_tasks(uuid,uuid[],timestamptz)') is null or to_regprocedure('public.save_v2_task_progress(uuid,integer,jsonb)') is null or to_regprocedure('public.submit_v2_task(uuid,integer,text)') is null or to_regprocedure('public.review_v2_task(uuid,text,text,uuid[])') is null then raise exception 'V2 task RPC missing'; end if;
 if has_table_privilege('authenticated','public.v2_tasks','INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.v2_task_answers','INSERT,UPDATE,DELETE') then raise exception 'V2 task direct writes must be blocked'; end if;
 raise notice 'StoreHub V2 task execution schema checks passed';
end $$;
