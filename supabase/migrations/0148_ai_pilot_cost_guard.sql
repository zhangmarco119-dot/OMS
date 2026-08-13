-- Keep the two-store pilot focused on new work. The first rollout migration
-- intentionally created a bounded historical sample, but that sample must not
-- continue consuming model quota after deployment validation is complete.

do $$
declare
  v_cutoff timestamptz := clock_timestamp();
begin
  with stale_runs as (
    update public.ai_review_runs
    set status = 'stale',
        completed_at = coalesce(completed_at, now()),
        error_code = 'PILOT_INITIAL_BACKFILL_CANCELLED',
        error_message = 'Historical pilot backfill was stopped by the rollout cost guard.',
        updated_at = now()
    where trigger_type = 'auto'
      and created_by is null
      and created_at <= v_cutoff
      and status in ('queued', 'running', 'failed')
    returning id, store_id
  )
  insert into public.ai_suggestion_events(run_id, store_id, event_type, metadata)
  select id, store_id, 'stale', jsonb_build_object(
    'reason', 'pilot_initial_backfill_cancelled',
    'costGuard', true
  )
  from stale_runs;

  update public.ai_review_queue queue
  set status = 'cancelled',
      locked_at = null,
      locked_by = null,
      last_error = 'Historical pilot backfill cancelled by cost guard.',
      updated_at = now()
  from public.ai_review_runs run
  where run.id = queue.run_id
    and run.error_code = 'PILOT_INITIAL_BACKFILL_CANCELLED'
    and queue.status in ('queued', 'running', 'failed');

  update private.ai_review_settings
  set daily_run_limit = least(daily_run_limit, 200),
      configured_at = now()
  where singleton;
end;
$$;
