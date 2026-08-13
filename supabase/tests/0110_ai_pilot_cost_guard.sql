begin;

do $$
declare
  v_daily_limit integer;
  v_unfinished_backfill integer;
  v_uncancelled_queue integer;
begin
  select daily_run_limit
  into v_daily_limit
  from private.ai_review_settings
  where singleton;

  if v_daily_limit > 200 then
    raise exception 'AI pilot daily run limit is %, expected at most 200', v_daily_limit;
  end if;

  select count(*)
  into v_unfinished_backfill
  from public.ai_review_runs
  where trigger_type = 'auto'
    and created_by is null
    and status in ('queued', 'running', 'failed');

  if v_unfinished_backfill <> 0 then
    raise exception '% historical AI pilot runs are still consuming quota', v_unfinished_backfill;
  end if;

  select count(*)
  into v_uncancelled_queue
  from public.ai_review_queue queue
  join public.ai_review_runs run on run.id = queue.run_id
  where run.error_code = 'PILOT_INITIAL_BACKFILL_CANCELLED'
    and queue.status <> 'cancelled';

  if v_uncancelled_queue <> 0 then
    raise exception '% cost-guard queue rows were not cancelled', v_uncancelled_queue;
  end if;
end;
$$;

rollback;
