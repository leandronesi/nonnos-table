-- Rolling corpus retention: keep only the latest 100 games for the selected
-- goal cadence. Rows are deleted transactionally while object paths are first
-- placed in a durable per-user queue, so a browser/storage failure is retryable.

create table if not exists public.corpus_prune_batches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  object_paths text[] not null,
  created_at   timestamptz not null default now()
);

create index if not exists corpus_prune_batches_user_created_idx
  on public.corpus_prune_batches (user_id, created_at);

alter table public.corpus_prune_batches enable row level security;

drop policy if exists corpus_prune_batches_self_select on public.corpus_prune_batches;
create policy corpus_prune_batches_self_select on public.corpus_prune_batches
  for select using (auth.uid() = user_id);

drop policy if exists corpus_prune_batches_self_delete on public.corpus_prune_batches;
create policy corpus_prune_batches_self_delete on public.corpus_prune_batches
  for delete using (auth.uid() = user_id);

revoke all on public.corpus_prune_batches from public, anon, authenticated;
grant select, delete on public.corpus_prune_batches to authenticated;

create or replace function public.stage_corpus_prune(
  p_goal_time_class text,
  p_keep int default 100
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_game_ids uuid[];
  v_paths text[];
  v_batch_id uuid;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_goal_time_class is null or p_goal_time_class not in ('rapid', 'blitz') then
    raise exception 'unsupported_goal_time_class';
  end if;
  if p_keep <> 100 then raise exception 'invalid_retention_window'; end if;

  perform pg_advisory_xact_lock(
    hashtext('corpus-prune:' || v_user_id::text || ':' || p_goal_time_class)
  );
  if not exists (
    select 1 from public.profiles
    where user_id = v_user_id and goal_time_class = p_goal_time_class
  ) then raise exception 'profile_scope_mismatch'; end if;

  select coalesce(array_agg(old.id), '{}'::uuid[])
    into v_game_ids
  from (
    select ranked.id
    from (
      select id, time_class, played_at,
             row_number() over (partition by time_class order by played_at desc) as recency_rank
      from public.games
      where user_id = v_user_id
    ) ranked
    where ranked.time_class <> p_goal_time_class
       or ranked.recency_rank > p_keep
    order by ranked.played_at asc
    limit 500
  ) old;

  delete from public.ingest_jobs
  where user_id = v_user_id
    and status in ('done', 'error')
    and id not in (
      select id
      from public.ingest_jobs
      where user_id = v_user_id and status in ('done', 'error')
      order by created_at desc
      limit 20
    );

  if cardinality(v_game_ids) = 0 then return null; end if;

  select coalesce(array_agg(distinct paths.path), '{}'::text[])
    into v_paths
  from public.games g
  cross join lateral unnest(array[g.pgn_path, g.analysis_path]) as paths(path)
  where g.id = any(v_game_ids) and paths.path is not null;

  insert into public.corpus_prune_batches (user_id, object_paths)
  values (v_user_id, v_paths)
  returning id into v_batch_id;

  delete from public.games
  where user_id = v_user_id and id = any(v_game_ids);

  return v_batch_id;
end;
$$;

revoke all on function public.stage_corpus_prune(text, int)
  from public, anon;
grant execute on function public.stage_corpus_prune(text, int)
  to authenticated;
