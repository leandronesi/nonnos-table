-- Pre-lease clients could leave several main jobs active. A later completed
-- main job proves the older run was superseded; it must not block refresh.
-- Keep paused current runs and any worker with a live lease untouched.
update public.ingest_jobs old_run
set status = 'error',
    error = 'superseded_by_completed_run',
    finished_at = coalesce(old_run.finished_at, now()),
    lease_token = null,
    lease_expires_at = null
where old_run.kind = 'main'
  and old_run.status in ('queued', 'fetching', 'analyzing', 'analyzing_first',
                         'coaching_first', 'analyzing_rest', 'coaching')
  and (old_run.lease_token is null or old_run.lease_expires_at <= now())
  and exists (
    select 1 from public.profiles p
    where p.user_id = old_run.user_id and p.onboarding_state = 'ready'
  )
  and exists (
    select 1 from public.ingest_jobs completed
    where completed.user_id = old_run.user_id
      and completed.kind = 'main'
      and completed.status = 'done'
      and completed.created_at > old_run.created_at
  );
