-- Remove the background AI auto-analysis queue. AI review now runs only when
-- an administrator is actively using the current screen (ensure/rerun/draft).

drop trigger if exists arrival_reports_ai_review_enqueue on public.arrival_reports;
drop trigger if exists tasks_ai_review_enqueue on public.tasks;
drop trigger if exists v2_tasks_ai_review_enqueue on public.v2_tasks;
drop trigger if exists product_creation_requests_ai_review_enqueue on public.product_creation_requests;
drop trigger if exists products_ai_review_enqueue on public.products;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'storehub-ai-review-queue';
end;
$$;
